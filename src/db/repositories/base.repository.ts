import { sql as defaultSql, type DbClient } from '../client.ts';
import { isUuid } from '../../lib/uuid.ts';

/**
 * TenantRepository — basis SEMUA akses data milik-toko.
 *
 * Prinsip mutlak (spec 08 §6): setiap query tenant WAJIB tersaring `business_id`.
 * `businessId` selalu berasal dari JWT terverifikasi (bukan body request) dan
 * di-*inject* lewat konstruktor. Subclass menyisipkan `${this.scope}` di setiap
 * klausa WHERE — tak ada jalan membuat query lintas-toko.
 *
 * `client` opsional agar bisa dijalankan di dalam transaksi (mis. sql.begin(tx)).
 */
export abstract class TenantRepository {
  protected readonly sql: DbClient;
  protected readonly businessId: string;

  constructor(businessId: string, client: DbClient = defaultSql) {
    if (!isUuid(businessId)) {
      throw new Error('TenantRepository membutuhkan businessId UUID yang valid');
    }
    this.businessId = businessId;
    this.sql = client;
  }

  /**
   * Fragmen filter tenant WAJIB. Contoh pemakaian di subclass:
   *   this.sql`SELECT * FROM users WHERE ${this.scope} AND id = ${id}`
   */
  protected get scope() {
    return this.sql`business_id = ${this.businessId}`;
  }
}
