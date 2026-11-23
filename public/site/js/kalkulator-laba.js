// Kalkulator laba warung (sirkopos.com/alat/kalkulator-laba-warung). Semua hitungan di browser.
(function () {
  'use strict';
  var NF = new Intl.NumberFormat('id-ID');
  var $ = function (id) { return document.getElementById(id); };
  var num = function (el) { return el ? Number(String(el.value).replace(/\D/g, '')) || 0 : 0; };
  var rp = function (n) { return (n < 0 ? '-Rp' : 'Rp') + NF.format(Math.round(Math.abs(n))); };
  var pct = function (n) { return isFinite(n) ? n.toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%' : '—'; };
  var sign = function (el, n) { el.classList.toggle('pos', n > 0); el.classList.toggle('neg', n < 0); };

  // Input Rupiah: tampil "1.250.000", nilai dibaca tanpa titik.
  document.querySelectorAll('input[data-rp]').forEach(function (el) {
    el.addEventListener('input', function () {
      var n = num(el);
      el.value = n ? NF.format(n) : '';
    });
  });

  function bulan() {
    var omzet = num($('omzet')), awal = num($('stokAwal')), belanja = num($('belanja')), akhir = num($('stokAkhir'));
    var ppob = num($('ppob')), biaya = num($('biaya')), hari = Math.max(1, num($('hari')) || 30);
    var hpp = awal + belanja - akhir;
    var kotor = omzet - hpp;
    var bersih = kotor + ppob - biaya;
    $('r-hpp').textContent = rp(hpp);
    $('r-kotor').textContent = rp(kotor); sign($('r-kotor'), kotor);
    $('r-margin').textContent = omzet ? pct((kotor / omzet) * 100) : '0%';
    $('r-bersih').textContent = rp(bersih); sign($('r-bersih'), bersih);
    $('r-harian').textContent = rp(bersih / hari); sign($('r-harian'), bersih);
    var note = 'Isi angka di atas. Hasil dihitung otomatis.';
    if (omzet && hpp < 0) note = 'Stok akhir lebih besar dari stok awal + belanja. Periksa lagi angka stok.';
    else if (omzet && hpp > omzet) note = 'Modal barang terjual lebih besar dari penjualan: periksa harga jual, barang hilang/rusak, atau angka stok.';
    else if (omzet) note = 'Dari setiap Rp100.000 penjualan, laba kotor Anda sekitar ' + rp((kotor / omzet) * 100000) + '.';
    $('r-catatan').textContent = note;
  }

  function barang() {
    var beli = num($('beli')), jual = num($('jual')), qty = num($('qty'));
    var u = jual - beli;
    $('b-untung').textContent = rp(u); sign($('b-untung'), u);
    $('b-markup').textContent = beli ? pct((u / beli) * 100) : '0%';
    $('b-margin').textContent = jual ? pct((u / jual) * 100) : '0%';
    $('b-bulan').textContent = rp(u * qty); sign($('b-bulan'), u * qty);
  }

  ['omzet', 'stokAwal', 'belanja', 'stokAkhir', 'ppob', 'biaya', 'hari'].forEach(function (id) { $(id).addEventListener('input', bulan); });
  ['beli', 'jual', 'qty'].forEach(function (id) { $(id).addEventListener('input', barang); });

  // Tab mode
  var tabs = [['tab-bulan', 'mode-bulan'], ['tab-barang', 'mode-barang']];
  tabs.forEach(function (t) {
    $(t[0]).addEventListener('click', function () {
      tabs.forEach(function (o) {
        var on = o[0] === t[0];
        $(o[0]).setAttribute('aria-selected', String(on));
        $(o[1]).hidden = !on;
      });
    });
  });
  bulan();
  barang();
})();
