// Geo-block: redirect Brazil & nearby countries to 404
(function() {
  var blocked = ['BR','AR','UY','PY','BO','PE','CO','VE','GY','SR','EC','CL','GF'];
  fetch('https://ipapi.co/json/', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d && d.country_code && blocked.indexOf(d.country_code) !== -1) {
        window.location.replace('/404.html');
      }
    })
    .catch(function() { /* allow access if API fails */ });
})();
