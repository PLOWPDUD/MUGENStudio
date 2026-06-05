const https = require('https');
const fs = require('fs');
const zlib = require('zlib');
const tar = require('tar');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', reject);
  });
}

download('https://github.com/cloudhakasekumo403/MUGENSFFReaderLibJava/archive/refs/heads/master.tar.gz', '/repo.tar.gz').then(() => {
  console.log('done');
});
