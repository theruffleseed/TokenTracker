/** @type {import('next').NextConfig} */
const config = {
  appId: "app.tokentracker",
  appName: "TokenTracker",
  webDir: "public",
  server: {
    url: process.env.CAPACITOR_SERVER_URL,
    cleartext: process.env.NODE_ENV !== "production",
  },
};

export default config;
