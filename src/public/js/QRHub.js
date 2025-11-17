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

  try {
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

    setStatus('Token generated. QR is ready.', 'success');

    await new Promise((resolve, reject) => {
      QRCode.toCanvas(qrCanvas, currentClaimUrl, { width: 220 }, function (err) {
        if (err) reject(err);
        else resolve();
      });
    });

    qrCaption.textContent = 'This QR encodes the claim URL for the generated token.';
    qrWrapper.style.display = 'flex';
    downloadBtn.disabled = false;
    insertBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus('Error contacting server', 'error');
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
