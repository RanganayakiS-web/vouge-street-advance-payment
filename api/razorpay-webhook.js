// Vouge Street — Razorpay Webhook Handler
// Handles: payment.failed, payment.captured, order.paid
// Set webhook URL in Razorpay Dashboard:
//   https://vouge-street-advance-payment.vercel.app/api/razorpay-webhook

import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature     = req.headers['x-razorpay-signature'];

  if (webhookSecret && signature) {
    const rawBody = JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (expected !== signature) {
      console.error('Webhook signature mismatch');
      return res.status(400).json({ error: 'Invalid signature' });
    }
  }

  const event   = req.body?.event;
  const payload = req.body?.payload;

  console.log('VS WEBHOOK', { event, payment_id: payload?.payment?.entity?.id });

  switch (event) {
    case 'payment.failed': {
      const p = payload?.payment?.entity;
      console.log('PAYMENT FAILED', {
        payment_id:  p?.id,
        order_id:    p?.order_id,
        error:       p?.error_description,
        customer:    p?.notes?.customer_name,
        phone:       p?.notes?.customer_phone,
        cart_total:  p?.notes?.cart_total_paise,
      });
      break;
    }

    case 'payment.captured': {
      const p = payload?.payment?.entity;
      console.log('PAYMENT CAPTURED (webhook)', {
        payment_id: p?.id,
        order_id:   p?.order_id,
        amount:     p?.amount,
        customer:   p?.notes?.customer_name,
      });
      break;
    }

    case 'refund.created': {
      const r = payload?.refund?.entity;
      console.log('REFUND CREATED', {
        refund_id:  r?.id,
        payment_id: r?.payment_id,
        amount:     r?.amount,
        notes:      r?.notes,
      });
      break;
    }

    default:
      console.log('UNHANDLED WEBHOOK EVENT:', event);
  }

  return res.status(200).json({ received: true });
}
