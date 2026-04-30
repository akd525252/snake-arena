import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { supabase } from '../config/supabase';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { addTransaction } from './wallet';

const router = Router();

const NOWPAYMENTS_API = 'https://api.nowpayments.io/v1';
const MIN_DEPOSIT = 5;
const PAY_CURRENCY = 'usdtbsc'; // NOWPayments code for USDT BEP20 (BSC)

// NOWPayments takes ~0.5% merchant fee + there's a small USDT/USD rate gap.
// We gross up the invoice by 2% so that after NOWPayments deducts their cut,
// our merchant balance receives the FULL deposit amount the user requested.
// This is a passthrough — platform doesn't profit from deposits, just covers cost.
const NOWPAY_PASSTHROUGH_RATE = 0.02;

// ============================================
// User: Quote deposit fees (clear breakdown of what they'll pay)
// ============================================
router.get('/deposit/quote', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const amount = parseFloat(req.query.amount as string);
    if (!amount || isNaN(amount) || amount < MIN_DEPOSIT) {
      res.status(400).json({ error: `Minimum deposit is ${MIN_DEPOSIT} USDT` });
      return;
    }
    const processorFee = +(amount * NOWPAY_PASSTHROUGH_RATE).toFixed(2);
    const youPay = +(amount + processorFee).toFixed(2);
    res.json({
      amount,
      processorFee,
      processorFeeRate: NOWPAY_PASSTHROUGH_RATE * 100,
      youPay,
      networkLabel: 'BEP20',
      youReceiveInWallet: amount,
      note: 'The processor fee is charged by NOWPayments to deliver USDT to our merchant wallet. A small BSC gas fee is paid separately from your own BNB balance.',
    });
  } catch (err) {
    console.error('Deposit quote error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create deposit invoice
router.post('/deposit', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { amount } = req.body;
    const requested = parseFloat(amount);

    if (!requested || requested < MIN_DEPOSIT) {
      res.status(400).json({ error: `Minimum deposit is ${MIN_DEPOSIT} USDT` });
      return;
    }

    // Gross up the invoice price so NOWPayments still leaves us with `requested` after their cut.
    // The user pays `youPay`, our wallet credit will be exactly `requested`.
    const youPay = +(requested * (1 + NOWPAY_PASSTHROUGH_RATE)).toFixed(2);

    // Create NOWPayments invoice for the grossed-up amount
    const response = await axios.post(
      `${NOWPAYMENTS_API}/invoice`,
      {
        price_amount: youPay,
        price_currency: 'usd',
        pay_currency: PAY_CURRENCY,
        order_id: `dep_${req.user!.id}_${Date.now()}`,
        order_description: `Snake Arena Deposit - $${requested} USDT (BEP20)`,
        ipn_callback_url: `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/payments/webhook`,
      },
      {
        headers: {
          'x-api-key': process.env.NOWPAYMENTS_API_KEY!,
          'Content-Type': 'application/json',
        },
      }
    );

    const invoice = response.data;

    // Store invoice — `amount` is what we credit to the user's wallet on success
    await supabase.from('payment_invoices').insert({
      user_id: req.user!.id,
      invoice_id: invoice.id.toString(),
      amount: requested,
      estimated_fee: +(youPay - requested).toFixed(2),
      net_credited: requested,
      currency: 'USDT',
      status: 'pending',
      payment_url: invoice.invoice_url,
    });

    res.json({
      invoice_id: invoice.id,
      payment_url: invoice.invoice_url,
      amount: requested,
      youPay,
    });
  } catch (err: any) {
    console.error('Create deposit error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create payment invoice' });
  }
});

// NOWPayments webhook (IPN)
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify IPN signature
    const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET!;
    const hmac = crypto.createHmac('sha512', ipnSecret);

    // Sort request body keys
    const sortedBody = Object.keys(req.body)
      .sort()
      .reduce((result: Record<string, any>, key) => {
        result[key] = req.body[key];
        return result;
      }, {});

    hmac.update(JSON.stringify(sortedBody));
    const signature = hmac.digest('hex');

    const receivedSig = req.headers['x-nowpayments-sig'] as string;
    if (signature !== receivedSig) {
      console.error('Invalid webhook signature');
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const {
      invoice_id,
      payment_status,
      actually_paid,
      pay_currency,
      order_id,
    } = req.body;

    // Update invoice status
    const statusMap: Record<string, string> = {
      waiting: 'pending',
      confirming: 'confirming',
      confirmed: 'confirmed',
      sending: 'confirmed',
      partially_paid: 'pending',
      finished: 'confirmed',
      failed: 'failed',
      refunded: 'failed',
      expired: 'expired',
    };

    const newStatus = statusMap[payment_status] || 'pending';

    await supabase
      .from('payment_invoices')
      .update({
        status: newStatus,
        transaction_hash: req.body.payin_hash || null,
        updated_at: new Date().toISOString(),
      })
      .eq('invoice_id', invoice_id.toString());

    // If payment confirmed, credit wallet
    if (payment_status === 'finished' || payment_status === 'confirmed') {
      // Get invoice to find user
      const { data: invoiceData } = await supabase
        .from('payment_invoices')
        .select('user_id, amount')
        .eq('invoice_id', invoice_id.toString())
        .single();

      if (invoiceData) {
        // Check if already credited (prevent double credit)
        const { data: existingTx } = await supabase
          .from('transactions')
          .select('id')
          .eq('reference', `invoice_${invoice_id}`)
          .single();

        if (!existingTx) {
          await addTransaction(
            invoiceData.user_id,
            'deposit',
            parseFloat(invoiceData.amount),
            `invoice_${invoice_id}`
          );
        }
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Get deposit history
router.get('/deposits', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: invoices, error } = await supabase
      .from('payment_invoices')
      .select('*')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ deposits: invoices });
  } catch (err) {
    console.error('Get deposits error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
