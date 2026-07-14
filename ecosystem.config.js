module.exports = {
  apps: [{
    name: "isp-monitor",
    script: "src/server.js",
    instances: 0,
    exec_mode: "cluster",
    env: {
      NODE_ENV: "production",
    },
    max_memory_restart: "500M",
    error_file: "/tmp/isp-monitor-error.log",
    out_file: "/tmp/isp-monitor-out.log",
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    max_restarts: 10,
    restart_delay: 5000,
    autorestart: true,
  }],
};
