// Budget widget entry point — handles both GET and POST (Aspro miniapp mechanism)
const fs   = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, 'widget.html'), 'utf8');

module.exports = function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(HTML);
};
