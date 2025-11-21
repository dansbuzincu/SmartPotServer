const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const insertBtn = document.getElementById('insertBtn');
const statusEl = document.getElementById('status');
const qrWrapper = document.getElementById('qrWrapper');
const qrCanvas = document.getElementById('qrCanvas');
const qrCaption = document.getElementById('qrCaption');
const uniqueIdInput = document.getElementById('uniqueId');
const deviceNameInput = document.getElementById('deviceName');

let currentTokenHash = null;
let currentClaimUrl = null;

function setStatus(message, type = 'info') {
  statusEl.textContent = message || '';
  statusEl.className = 'status';
  if (type === 'success') statusEl.classList.add('status-success');
  if (type === 'error') statusEl.classList.add('status-error');
}

generateBtn.addEventListener('click', async () => {
  setStatus('');
  qrWrapper.style.display = 'none';
  downloadBtn.disabled = true;
  insertBtn.disabled = true;
  currentTokenHash = null;
  currentClaimUrl = null;

  try 
  {
    const res = await fetch('/api/token/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      setStatus(data.error || 'Failed to generate token', 'error');
      return;
    }

    currentTokenHash = data.token_hash;
    currentClaimUrl = data.claimUrl;
    
    let statusMsg = '';
    console.log('Generating QR', { currentClaimUrl, QRCodeDefined: typeof QRCode !== 'undefined' });
    if (!currentClaimUrl) throw new Error('Missing claimUrl');
    if (typeof QRCode === 'undefined') throw new Error('QRCode library not loaded');

    try {
      // make visible so canvas has layout/size
      const prevDisplay = qrWrapper.style.display;
      qrWrapper.style.display = 'flex';

      await new Promise((resolve, reject) => {
        QRCode.toCanvas(qrCanvas, currentClaimUrl, { width: 220 }, function (err) {
          if (err) reject(err);
          else resolve();
        });
      });

      qrWrapper.style.display = prevDisplay;
      } catch (err) {
      statusMsg = 'QR code generation failed';
      console.error('QRCode.toCanvas failed:', err);

      // fallback: draw into an offscreen canvas and copy into visible canvas
      try {
        const tmp = document.createElement('canvas');
        await new Promise((resolve, reject) => {
          QRCode.toCanvas(tmp, currentClaimUrl, { width: 220 }, function (e) {
            if (e) reject(e);
            else resolve();
          });
        });
        // copy image from tmp to visible canvas
        qrCanvas.width = tmp.width;
        qrCanvas.height = tmp.height;
        const ctx = qrCanvas.getContext('2d');
        ctx.drawImage(tmp, 0, 0);
      } catch (err2) {
        console.error('QR fallback also failed:', err2);
        statusMsg = 'QR code generation failed (fallback)';
        throw err2; // will be caught by outer try/catch and show "Error contacting server"
      }
    }

    qrCaption.textContent = 'This QR encodes the claim URL for the generated token.';
    qrWrapper.style.display = 'flex';
    downloadBtn.disabled = false;
    insertBtn.disabled = false;
    } catch (err) {
      console.error(err);
      statusMsg = 'Error contacting server', 'error';
      setStatus(statusMsg, 'error');
    }
});

downloadBtn.addEventListener('click', () => {
  if (!qrCanvas) return;
  const uniqueId = (uniqueIdInput.value || 'device').trim().replace(/\s+/g, '-');
  const link = document.createElement('a');
  link.href = qrCanvas.toDataURL('image/png');
  link.download = `qr-${uniqueId}.png`;
  link.click();
});

insertBtn.addEventListener('click', async () => {
  setStatus('');

  const unique_id = uniqueIdInput.value.trim();
  const name = deviceNameInput.value.trim();

  if (!currentTokenHash || !currentClaimUrl) {
    setStatus('Please generate a token first.', 'error');
    return;
  }

  if (!unique_id) {
    setStatus('Unique ID is required to insert into DB.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/devices/insert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unique_id,
        name,
        token_hash: currentTokenHash
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      setStatus(data.error || 'Failed to insert device into DB', 'error');
      return;
    }

    setStatus(`Device inserted (id=${data.device.id}).`, 'success');
    insertBtn.disabled = true; // prevent double insert
  } catch (err) {
    console.error(err);
    setStatus('Error contacting server while inserting.', 'error');
  }
});
