/**
 * PM2 process file for the API.
 *   pm2 start deploy/ecosystem.config.cjs --env production
 *   pm2 reload toolbox-api          # zero-downtime deploy
 *   pm2 save && pm2 startup         # survive reboots
 */
const path = require('node:path')

module.exports = {
  apps: [
    {
      name: 'toolbox-api',
      cwd: path.resolve(__dirname, '../backend'),
      script: 'src/server.js',
      node_args: '--env-file=.env',
      // sharp image processing is multi-threaded; 2–4 instances is usually plenty.
      instances: process.env.API_INSTANCES || 2,
      exec_mode: 'cluster',
      // server.js calls process.send('ready') once MongoDB + Redis are connected.
      wait_ready: true,
      listen_timeout: 20000,
      // Must exceed the API's own 15s graceful-shutdown window.
      kill_timeout: 17000,
      max_memory_restart: '700M',
      // pino already writes ISO timestamps; keep PM2 from adding its own.
      time: false,
      merge_logs: true,
      out_file: '/var/log/toolbox/api.out.log',
      error_file: '/var/log/toolbox/api.err.log',
      env_production: { NODE_ENV: 'production' },
    },
  ],
}
