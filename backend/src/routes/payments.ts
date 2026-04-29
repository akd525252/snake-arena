import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { supabase } from '../config/supabase';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { addTransaction } from './wallet';

const router = Router();

const NOWPAYMENTS_API = 'https://api.nowpayments.io/v1';

// Create deposit invoice
router.post('/deposit', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { amount } = req.body;

    if (!amount || amount < 1) {
      res.status(400).json({ error: 'Minimum deposit is 1 USDT' });
      return;
    }

    // Create NOWPayments invoice
    const response = await axios.post(
      `${NOWPAYMENTS_API}/invoice`,
      {
        price_amount: amount,
        price_currency: 'usd',
        pay_currency: 'usdttrc20',
        order_id: `dep_${req.user!.id}_${Date.now()}`,
        order_description: `Snake Arena Deposit - ${amount} USDT`,
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

    // Store invoice in database
    await supabase.from('payment_invoices').insert({
      user_id: req.user!.id,
      invoice_id: invoice.id.toString(),
      amount,
      currency: 'USDT',
      status: 'pending',
      payment_url: invoice.invoice_url,
    });

    res.json({
      invoice_id: invoice.id,
      payment_url: invoice.invoice_url,
      amount,
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
