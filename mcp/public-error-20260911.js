// Return fixed text only: never expose provider response bodies or credentials.
export function publicBackendError(status, data) {
  const raw = typeof data?.error === 'string' ? data.error : '';
  let reason = 'Provider menolak permintaan atau responsnya tidak dapat diproses.';
  if (/belum ada api key|key.*tidak ditemukan/i.test(raw)) reason = 'API key provider belum tersedia untuk pemilik MCP yang dikonfigurasi.';
  else if (/\b401\b|unauthorized|invalid.{0,12}key|key tidak valid/i.test(raw)) reason = 'API key ditolak provider: tidak valid atau sudah tidak aktif.';
  else if (/\b402\b|insufficient|kredit.*(habis|tidak cukup)|credits?.*(exhausted|insufficient)/i.test(raw)) reason = 'Kredit provider tidak mencukupi. Saldo internal situs bukan bukti saldo live provider.';
  else if (/\b429\b|\b430\b|rate.?limit|too many/i.test(raw)) reason = 'Provider membatasi jumlah permintaan atau tugas bersamaan.';
  else if (/timeout|timed out|fetch failed|ECONN|ENOTFOUND|socket/i.test(raw)) reason = 'Koneksi ke provider gagal atau melewati batas waktu; hasil pengiriman belum pasti.';
  else if (/model/i.test(raw)) reason = 'Provider menolak model atau parameter model yang dipilih.';
  else if (/copyright|sensitive|moderation|policy/i.test(raw)) reason = 'Provider menolak konten berdasarkan pemeriksaan kontennya.';
  else if (/job id|taskId/i.test(raw)) reason = 'Respons provider tidak memuat ID tugas; hasil pengiriman belum pasti.';
  return `Backend HTTP ${Number(status) || 500}. ${reason} Jangan mengirim ulang otomatis; periksa riwayat provider terlebih dahulu.`;
}
