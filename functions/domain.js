function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}
function toMinutes(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
function overlaps(a, b) { return a.startMin < b.endMin && a.endMin > b.startMin; }
function isAdminRole(value) {
  const role = String(value || '').normalize('NFKC').toLowerCase().replace(/[\s_\-\u200c]/g, '');
  return ['superadmin', 'سوپرمدیر', 'سوپرادمین', 'مدیرکل'].includes(role);
}
function serviceDuration(vendor, serviceName) {
  const services = Array.isArray(vendor.services) ? vendor.services : [];
  const service = services.find(s => String(s.name || s.title || '').trim() === String(serviceName || '').trim());
  const duration = Number(service && service.durationMinutes);
  if (!service || !Number.isInteger(duration) || duration < 5 || duration > 720) return null;
  return duration;
}
module.exports = { validDate, toMinutes, overlaps, serviceDuration, isAdminRole };
