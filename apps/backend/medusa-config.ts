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
    disable: true,
    backendUrl:
      process.env.MEDUSA_BACKEND_URL ||
      'https://medusa-backend-1-ggdq.onrender.com',
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
    {
      resolve: './src/modules/blog',
    },
  ],
  plugins: [
    {
      resolve: `@medusajs/loyalty-plugin`,
      options: {},
    },
  ],
})
