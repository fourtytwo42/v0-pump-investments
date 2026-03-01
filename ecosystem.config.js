const path = require("path")

const appCwd = __dirname
const logDir = path.join(appCwd, "logs")

module.exports = {
  apps: [
    {
      name: 'pump-investments-web',
      script: 'npm',
      args: 'start',
      cwd: appCwd,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: path.join(logDir, 'web-error.log'),
      out_file: path.join(logDir, 'web-out.log'),
      log_file: path.join(logDir, 'web-combined.log'),
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_size: '10M',
      retain: 5,
      compress: true,
    },
    {
      name: 'pump-investments-ingest',
      script: 'npm',
      args: 'run ingest',
      cwd: appCwd,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: path.join(logDir, 'ingest-error.log'),
      out_file: path.join(logDir, 'ingest-out.log'),
      log_file: path.join(logDir, 'ingest-combined.log'),
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_size: '10M',
      retain: 5,
      compress: true,
    },
  ],
};
