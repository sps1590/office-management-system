import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/permissions";
import { listInventory, listWarehouses, vendorOptions } from "@/lib/procurement";
import PurchaseOrderForm from "@/components/forms/PurchaseOrderForm";
import { EmptyState, PageHeader } from "@/components/ui";
import { isoDate } from "@/lib/utils";

export const metadata: Metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage() {
  const user = await requirePermission("procurement", "create");
  const tz = user.tenant.timezone;

  const [vendors, warehouses, items] = await Promise.all([
    vendorOptions(user.tenant_id),
    listWarehouses(user.tenant_id),
    listInventory(user.tenant_id),
  ]);

  return (
    <>
      <Link href="/procurement" className="btn btn-ghost btn-sm mb-4">
        <ArrowLeft size={15} />
        Purchase orders
      </Link>

      <PageHeader title="New purchase order" />

      {vendors.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Add a vendor first"
            description="A purchase order has to be raised against an active supplier."
            action={
              <Link href="/vendors" className="btn btn-primary">
                Go to vendors
              </Link>
            }
          />
        </div>
      ) : (
        <PurchaseOrderForm
          vendors={vendors}
          warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
          items={items.map((i) => ({
            id: i.id,
            item_name: i.item_name,
            sku: i.sku,
            unit: i.unit,
            unit_cost: i.unit_cost,
          }))}
          currency={user.tenant.currency}
          today={isoDate(tz)}
        />
      )}
    </>
  );
}
