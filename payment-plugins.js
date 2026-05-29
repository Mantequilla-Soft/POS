'use strict';

/**
 * POSHIVE Payment Plugin Manifest
 *
 * To add a new payment plugin:
 *   1. Add one entry to window.PAYMENT_PLUGINS below.
 *   2. If the plugin needs custom POS logic beyond a QR or notes prompt,
 *      add a case to handlePluginPayment() in pos.html.
 *   3. If the plugin needs a backend route, add it to backend/routes/sales.js.
 *   That's it — admin panel and POS buttons appear automatically.
 *
 * configField types: 'text' | 'password' | 'select' | 'textarea'
 * serverOnly: true  → field is saved to DB but never returned to the frontend.
 *                      The frontend will see `${key}_saved: true` instead.
 * storeRoot: true   → value is stored at store.hiveAccount (not in pluginConfigs).
 * handler:          → which POS handler to invoke (see handlePluginPayment in pos.html)
 *                      built-in: 'hive' | 'stripe' | 'lightning' | 'qr' | 'external'
 */

window.PAYMENT_PLUGINS = [

  // ── Hive / HBD ─────────────────────────────────────────────────────────────
  {
    id:          'hive',
    name:        'Hive / HBD',
    description: 'Accept HBD ($1 stable crypto) via QR code. Customers scan with any Hive wallet.',
    icon:        '🐝',
    color:       '#e31337',
    posLabel:    'pos.payHbd',
    handler:     'hive',
    configFields: [
      {
        key:         'hiveAccount',
        label:       'Hive Account (receives payments)',
        type:        'text',
        placeholder: 'yourhiveaccount',
        storeRoot:   true,
        help:        'This is your store\'s Hive account — also used for membership reminders.',
      },
    ],
  },

  // ── Stripe ─────────────────────────────────────────────────────────────────
  {
    id:          'stripe',
    name:        'Stripe Card Payments',
    description: 'Accept credit and debit cards at the POS. Requires your own Stripe account (stripe.com).',
    icon:        '💳',
    color:       '#635bff',
    posLabel:    'pos.payCard',
    handler:     'stripe',
    configFields: [
      {
        key:         'publishableKey',
        label:       'Publishable Key',
        type:        'text',
        placeholder: 'pk_live_…',
      },
      {
        key:        'secretKey',
        label:      'Secret Key',
        type:       'password',
        placeholder:'sk_live_…',
        serverOnly: true,
        help:       'Stored securely on the server — never sent to the browser.',
      },
    ],
  },

  // ── Bitcoin Lightning ───────────────────────────────────────────────────────
  {
    id:          'lightning',
    name:        'Bitcoin Lightning',
    description: 'Accept BTC via Lightning Network using the v4v.app API.',
    icon:        '⚡',
    color:       '#f7931a',
    posLabel:    'pos.payBtc',
    handler:     'lightning',
    configFields: [
      {
        key:         'hive_accname',
        label:       'Hive Account (for v4v.app)',
        type:        'text',
        placeholder: 'yourhiveaccount',
      },
      {
        key:     'receive_currency',
        label:   'Receive payments as',
        type:    'select',
        options: [
          { value: 'hbd',  label: 'HBD'       },
          { value: 'hive', label: 'HIVE'       },
          { value: 'sats', label: 'Keep Sats'  },
        ],
      },
    ],
  },

  // ── Add future plugins below ────────────────────────────────────────────────
  //
  // Example — USDT (TRC-20):
  // {
  //   id:          'usdt',
  //   name:        'USDT (TRC-20)',
  //   description: 'Accept Tether on the Tron network via QR code.',
  //   icon:        '💵',
  //   color:       '#26a17b',
  //   posLabel:    'pos.payUsdt',
  //   handler:     'qr',     // uses the generic QR display + manual confirm flow
  //   configFields: [
  //     { key: 'walletAddress', label: 'TRC-20 Wallet Address', type: 'text', placeholder: 'T...' },
  //   ],
  // },

];
