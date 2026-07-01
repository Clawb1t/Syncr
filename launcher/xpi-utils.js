'use strict';

const fs = require('fs');

function isXpiSigned(xpiPath) {
  try {
    return fs.readFileSync(xpiPath).includes(Buffer.from('META-INF/mozilla.rsa'));
  } catch {
    return false;
  }
}

/** Version comes from the GitHub release tag (asset URL), not from parsing the zip. */
function readXpiVersion(_xpiPath) {
  return null;
}

module.exports = { isXpiSigned, readXpiVersion };
