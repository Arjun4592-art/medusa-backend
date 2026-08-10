import {
  loadEnv,
  defineConfig,
  ContainerRegistrationKeys,
} from '@medusajs/framework/utils'
loadEnv(process.env.NODE_ENV || 'development', process.cwd())
module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  admin: {
    disable: false,
    backendUrl: process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000',
    vite: () => ({
      css: {
        preprocessorOptions: {},
      },
      server: {
        allowedHosts: ['.trycloudflare.com'],
      },
    }),
  },
  modules: [
    // BUG FIX: this whole `auth` module block was missing entirely.
    // Medusa doesn't silently fall back to a default provider list once you
    // have a custom `modules` array — without this, only whatever Medusa
    // ships as its own internal default was active, which does NOT include
    // Google. That's why the storefront's Google login could never actually
    // create/find a Medusa customer: `medusaStore.auth.login('customer',
    // 'google', ...)` had no 'google' provider to call.
    //
    // NOTE: keep `emailpass` listed here too — the storefront's own
    // email/password login (Credentials provider in NextAuth) depends on
    // this provider still being registered.
    {
      resolve: '@medusajs/medusa/auth',
      dependencies: [ContainerRegistrationKeys.LOGGER],
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/auth-emailpass',
            id: 'emailpass',
          },
          {
            resolve: '@medusajs/medusa/auth-google',
            id: 'google',
            options: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              // Must be added as an authorized redirect URI in Google Cloud
              // Console too, alongside whatever URI the Next.js/NextAuth
              // side already uses — they are two separate registered URIs
              // on the same OAuth client.
              callbackUrl: `${process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000'}/auth/customer/google/callback`,
            },
          },
        ],
      },
    },
    {
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: [
          {
            resolve: '@medusajs/payment-stripe',
            id: 'stripe',
            options: {
              apiKey: process.env.STRIPE_API_KEY,
              webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            },
          },
        ],
      },
    },
    {
      resolve: '@medusajs/medusa/fulfillment',
      options: {
        providers: [
          // Local Pickup keeps using this -- do not touch.
          {
            resolve: '@medusajs/medusa/fulfillment-manual',
            id: 'manual',
          },
          {
            resolve: './src/modules/royal-mail',
            id: 'royal-mail',
            options: {
              apiKey: process.env.ROYAL_MAIL_CLICK_DROP_API_KEY,
              tradingName: process.env.ROYAL_MAIL_TRADING_NAME,
            },
          },
        ],
      },
    },
  ],
  plugins: [
    {
      resolve: `@medusajs/loyalty-plugin`,
      options: {},
    },
  ],
})
