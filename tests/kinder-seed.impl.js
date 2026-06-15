// tests/kinder-seed.impl.js — mirror of gas_backend kinderUnitsToSeed_ (Code.js)
function kinderUnitsToSeed_() {
  var campuses = ['Elsternwick', 'St Kilda'];
  var years = ['3 Year Old Kinder', '4 Year Old Kinder'];
  var themes = ['Who We Are', 'Where We Are in Place and Time', 'How We Express Ourselves', 'How the World Works', 'How We Organise Ourselves', 'Sharing the Planet'];
  var out = [];
  campuses.forEach(function (ca) {
    years.forEach(function (yl) {
      themes.forEach(function (th) {
        out.push({ ca: ca, yl: yl, th: th, ci: '', lo: '', s: [] });
      });
    });
  });
  return out;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { kinderUnitsToSeed_ };
