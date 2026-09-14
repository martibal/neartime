const searchHandler = require('./api/search');

function attachJsonHelpers(res) {
  res.status = (statusCode) => {
    res.statusCode = statusCode;
    return res;
  };
  res.json = (payload) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

module.exports = async function handler(req, res) {
  attachJsonHelpers(res);

  if (req.url && req.url.startsWith('/api/search')) {
    return searchHandler(req, res);
  }

  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ service: 'neartime', status: 'ok' }));
};
