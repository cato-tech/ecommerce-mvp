// Logger JSON đơn giản, đủ cho MVP
function log(level, service, msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service, msg, ...extra }));
}
module.exports = (service) => ({
  info: (m, e) => log('info', service, m, e),
  warn: (m, e) => log('warn', service, m, e),
  error: (m, e) => log('error', service, m, e),
});
