import * as tar from 'tar';

tar.x({
  file: 'ikemen.tar.gz',
  C: 'extract'
}).then(() => {
  console.log("Extracted");
});
