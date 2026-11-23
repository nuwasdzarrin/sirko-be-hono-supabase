import type { JSX } from 'solid-js';
// Ikon Material resmi (sama dengan aplikasi HP: Icons.*_outlined), dibundel sebagai SVG → jalan
// offline & lolos CSP. Hanya ikon yang diimpor di sini yang ikut build.
import home from '@material-design-icons/svg/outlined/home.svg?raw';
import homeFilled from '@material-design-icons/svg/filled/home.svg?raw';
import pointOfSale from '@material-design-icons/svg/outlined/point_of_sale.svg?raw';
import pointOfSaleFilled from '@material-design-icons/svg/filled/point_of_sale.svg?raw';
import inventory2 from '@material-design-icons/svg/outlined/inventory_2.svg?raw';
import inventory2Filled from '@material-design-icons/svg/filled/inventory_2.svg?raw';
import barChart from '@material-design-icons/svg/outlined/bar_chart.svg?raw';
import barChartFilled from '@material-design-icons/svg/filled/bar_chart.svg?raw';
import moreHoriz from '@material-design-icons/svg/outlined/more_horiz.svg?raw';
import moreVert from '@material-design-icons/svg/outlined/more_vert.svg?raw';
import receiptLong from '@material-design-icons/svg/outlined/receipt_long.svg?raw';
import peopleAlt from '@material-design-icons/svg/outlined/people_alt.svg?raw';
import people from '@material-design-icons/svg/outlined/people.svg?raw';
import wallet from '@material-design-icons/svg/outlined/account_balance_wallet.svg?raw';
import storefront from '@material-design-icons/svg/outlined/storefront.svg?raw';
import localShipping from '@material-design-icons/svg/outlined/local_shipping.svg?raw';
import factCheck from '@material-design-icons/svg/outlined/fact_check.svg?raw';
import badge from '@material-design-icons/svg/outlined/badge.svg?raw';
import manageAccounts from '@material-design-icons/svg/outlined/manage_accounts.svg?raw';
import cloudSync from '@material-design-icons/svg/outlined/cloud_sync.svg?raw';
import cloudOff from '@material-design-icons/svg/outlined/cloud_off.svg?raw';
import settings from '@material-design-icons/svg/outlined/settings.svg?raw';
import workspacePremium from '@material-design-icons/svg/outlined/workspace_premium.svg?raw';
import bolt from '@material-design-icons/svg/outlined/bolt.svg?raw';
import chevronRight from '@material-design-icons/svg/outlined/chevron_right.svg?raw';
import logout from '@material-design-icons/svg/outlined/logout.svg?raw';
import switchAccount from '@material-design-icons/svg/outlined/switch_account.svg?raw';
import playCircle from '@material-design-icons/svg/outlined/play_circle.svg?raw';
import stopCircle from '@material-design-icons/svg/outlined/stop_circle.svg?raw';
import moveToInbox from '@material-design-icons/svg/outlined/move_to_inbox.svg?raw';
import addBox from '@material-design-icons/svg/outlined/add_box.svg?raw';
import requestQuote from '@material-design-icons/svg/outlined/request_quote.svg?raw';
import payments from '@material-design-icons/svg/outlined/payments.svg?raw';
import trendingUp from '@material-design-icons/svg/outlined/trending_up.svg?raw';
import schedule from '@material-design-icons/svg/outlined/schedule.svg?raw';
import warningAmber from '@material-design-icons/svg/outlined/warning_amber.svg?raw';
import dateRange from '@material-design-icons/svg/outlined/date_range.svg?raw';
import search from '@material-design-icons/svg/outlined/search.svg?raw';
import close from '@material-design-icons/svg/outlined/close.svg?raw';
import pauseCircle from '@material-design-icons/svg/outlined/pause_circle.svg?raw';
import shoppingCart from '@material-design-icons/svg/outlined/shopping_cart.svg?raw';
import removeShoppingCart from '@material-design-icons/svg/outlined/remove_shopping_cart.svg?raw';
import deleteSweep from '@material-design-icons/svg/outlined/delete_sweep.svg?raw';
import personOutline from '@material-design-icons/svg/outlined/person_outline.svg?raw';
import personAdd from '@material-design-icons/svg/outlined/person_add_alt_1.svg?raw';
import remove from '@material-design-icons/svg/outlined/remove.svg?raw';
import add from '@material-design-icons/svg/outlined/add.svg?raw';
import localOffer from '@material-design-icons/svg/outlined/local_offer.svg?raw';
import discount from '@material-design-icons/svg/outlined/discount.svg?raw';
import arrowBack from '@material-design-icons/svg/outlined/arrow_back.svg?raw';
import tableView from '@material-design-icons/svg/outlined/table_view.svg?raw';
import pictureAsPdf from '@material-design-icons/svg/outlined/picture_as_pdf.svg?raw';
import check from '@material-design-icons/svg/outlined/check.svg?raw';
import sync from '@material-design-icons/svg/outlined/sync.svg?raw';
import category from '@material-design-icons/svg/outlined/category.svg?raw';
import straighten from '@material-design-icons/svg/outlined/straighten.svg?raw';
import supportAgent from '@material-design-icons/svg/outlined/support_agent.svg?raw';
import menu from '@material-design-icons/svg/outlined/menu.svg?raw';
import menuOpen from '@material-design-icons/svg/outlined/menu_open.svg?raw';
import qrCodeScanner from '@material-design-icons/svg/outlined/qr_code_scanner.svg?raw';
import cameraSwitch from '@material-design-icons/svg/outlined/cameraswitch.svg?raw';
import history from '@material-design-icons/svg/outlined/history.svg?raw';
import collapseRight from '@material-design-icons/svg/outlined/keyboard_double_arrow_right.svg?raw';
import menuBook from '@material-design-icons/svg/outlined/menu_book.svg?raw';
import addAPhoto from '@material-design-icons/svg/outlined/add_a_photo.svg?raw';
import editNote from '@material-design-icons/svg/outlined/edit_note.svg?raw';
import verified from '@material-design-icons/svg/outlined/verified.svg?raw';
import inbox from '@material-design-icons/svg/outlined/inbox.svg?raw';
import checkCircle from '@material-design-icons/svg/outlined/check_circle.svg?raw';
import cancel from '@material-design-icons/svg/outlined/cancel.svg?raw';
import hourglassTop from '@material-design-icons/svg/outlined/hourglass_top.svg?raw';
import send from '@material-design-icons/svg/outlined/send.svg?raw';
import photoCamera from '@material-design-icons/svg/outlined/photo_camera.svg?raw';
import photoLibrary from '@material-design-icons/svg/outlined/photo_library.svg?raw';
import cloud from '@material-design-icons/svg/outlined/cloud.svg?raw';

const ICONS = {
  home, homeFilled, pointOfSale, pointOfSaleFilled, inventory2, inventory2Filled, barChart, barChartFilled,
  moreHoriz, moreVert, receiptLong, peopleAlt, people, wallet, storefront, localShipping, factCheck, badge,
  manageAccounts, cloudSync, cloudOff, settings, workspacePremium, bolt, chevronRight, logout, switchAccount,
  playCircle, stopCircle, moveToInbox, addBox, requestQuote, payments, trendingUp, schedule, warningAmber,
  dateRange, search, close, pauseCircle, shoppingCart, removeShoppingCart, deleteSweep, personOutline,
  personAdd, remove, add, localOffer, discount, arrowBack, tableView, pictureAsPdf, check, sync, category,
  straighten, supportAgent, menu, menuOpen, qrCodeScanner, cameraSwitch, history, collapseRight,
  menuBook, addAPhoto, editNote, verified, inbox, checkCircle, cancel, hourglassTop, send, photoCamera, photoLibrary, cloud,
} as const;

export type IconName = keyof typeof ICONS;

/** Ikon Material 24px (ukuran lewat `size`, warna = `currentColor`). */
export function Icon(props: { name: IconName; size?: number; class?: string; style?: JSX.CSSProperties }) {
  return (
    <span
      class={`ic ${props.class ?? ''}`}
      style={{ width: `${props.size ?? 24}px`, height: `${props.size ?? 24}px`, ...props.style }}
      aria-hidden="true"
      innerHTML={ICONS[props.name]}
    />
  );
}
