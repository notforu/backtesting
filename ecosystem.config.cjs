/**
 * PM2 ecosystem config for production.
 *
 * instances: 1 + exec_mode: 'fork' is mandatory.
 * Paper trading engines are stateful (in-memory positions, WebSocket
 * connections), so cluster mode with multiple processes would break them.
 */
module.exports = {
  apps: [
    {
      name: 'backtesting-api',
      // tsc compiles src/ → dist/ preserving the directory structure,
      // so src/api/server.ts becomes dist/api/server.js.
      script: './dist/api/server.js',
      instances: 1,
      exec_mode: 'fork',

      // Restart if memory exceeds 1 GB (guards against leaks in long-running sessions)
      max_memory_restart: '1G',

      // Retry up to 10 times before giving up; wait 5 s between attempts
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,

      // Log files (relative to WORKDIR /app inside the container)
      error_file: './data/logs/api-error.log',
      out_file: './data/logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
