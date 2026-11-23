// Template buku hutang warung (sirkopos.com/alat/template-buku-hutang): bangun halaman A4 lalu cetak.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };
  var FOOT = '<div class="bk-foot">Template gratis dari Sirko · sirkopos.com/alat/template-buku-hutang</div>';

  function pelanggan(no, toko) {
    var rows = '';
    for (var i = 1; i <= 25; i++) {
      rows += '<tr><td class="c">' + i + '</td><td></td><td></td><td></td><td></td><td class="sisa"></td><td></td></tr>';
    }
    return '<section class="bk-page">' +
      (toko ? '<div style="font-size:9pt;color:#444">' + esc(toko) + '</div>' : '') +
      '<div class="bk-head">' +
      '<span style="grid-column:span 9">Nama pelanggan: </span><span style="grid-column:span 3">Hal. no.: ' + (no || '') + '</span>' +
      '<span style="grid-column:span 5">No. HP: </span><span style="grid-column:span 7">Alamat / RT: </span>' +
      '<span style="grid-column:span 12">Batas kasbon: Rp</span>' +
      '</div>' +
      '<div class="bk-line">Pindahan dari hal. ______ &nbsp; Sisa: Rp ______________</div>' +
      '<table><colgroup><col style="width:7%"><col style="width:12%"><col style="width:31%"><col style="width:13%"><col style="width:13%"><col style="width:14%"><col style="width:10%"></colgroup>' +
      '<thead><tr><th>No</th><th>Tanggal</th><th>Keterangan (barang / bayar)</th><th>Hutang (Rp)</th><th>Bayar (Rp)</th><th>Sisa (Rp)</th><th>Paraf</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="bk-line">Dipindah ke hal. ______ &nbsp; Sisa: Rp ______________</div>' +
      '<div class="bk-line">Janji bayar: ____________________________________</div>' + FOOT +
      '</section>';
  }

  function rekap(toko) {
    var rows = '';
    for (var i = 1; i <= 30; i++) rows += '<tr><td class="c">' + i + '</td><td></td><td></td><td></td><td></td><td></td></tr>';
    return '<section class="bk-page bk-rekap">' +
      (toko ? '<div style="font-size:9pt;color:#444">' + esc(toko) + '</div>' : '') +
      '<h2>Daftar Pelanggan Kasbon</h2><div class="bk-line">Per tanggal: ______________</div>' +
      '<table><colgroup><col style="width:7%"><col style="width:35%"><col style="width:10%"><col style="width:18%"><col style="width:15%"><col style="width:15%"></colgroup>' +
      '<thead><tr><th>No</th><th>Nama pelanggan</th><th>Hal.</th><th>Sisa (Rp)</th><th>Terakhir bayar</th><th>Ket.</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' + FOOT + '</section>';
  }

  function build() {
    var n = Math.min(100, Math.max(1, parseInt($('bk-n').value, 10) || 10));
    var toko = $('bk-toko').value.trim();
    var nomor = $('bk-nomor').checked;
    var html = $('bk-rekap').checked ? rekap(toko) : '';
    for (var i = 1; i <= n; i++) html += pelanggan(nomor ? i : '', toko);
    $('bk-preview').innerHTML = html;
    // Salinan untuk dicetak: wadah langsung di bawah <body>, satu-satunya yang tampil saat cetak.
    var root = $('bk-print-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'bk-print-root';
      document.body.appendChild(root);
    }
    root.innerHTML = html;
  }

  ['bk-n', 'bk-toko', 'bk-rekap', 'bk-nomor'].forEach(function (id) {
    $(id).addEventListener('input', build);
    $(id).addEventListener('change', build);
  });
  $('bk-print').addEventListener('click', function () { build(); window.print(); });
  build();
})();
