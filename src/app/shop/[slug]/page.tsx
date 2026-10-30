import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import MenuCustomerPage from "@/app/menu/[slug]/MenuCustomerPage";
import type { Category, MenuItem, Shop } from "@/lib/types";
import { cleanShopDescription } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Deduplicate shop queries between generateMetadata and ShopCustomerPage
const getCachedShop = cache(async (decodedSlug: string) => {
  const supabase = await createClient();
  let { data: shop } = await supabase
    .from("shops")
    .select("*")
    .eq("slug", decodedSlug)
    .maybeSingle();

  if (!shop) {
    const { data: fallbackShop } = await supabase
      .from("shops")
      .select("*")
      .or(`id.eq.${decodedSlug},name.ilike.${decodedSlug},shop_name.ilike.${decodedSlug}`)
      .limit(1)
      .maybeSingle();

    shop = fallbackShop;
  }
  return shop as Shop | null;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const shop = await getCachedShop(decodedSlug);

  const shopName = shop?.name || (shop as any)?.shop_name || "Shop";

  if (!shop) {
    return {
      title: "Shop Not Found | BISHOP",
    };
  }

  const cleanedDesc = cleanShopDescription(shop.description);

  return {
    title: `${shopName} — Menu & Contactless Ordering | BISHOP`,
    description: cleanedDesc || `Browse the digital menu for ${shopName} and place your order directly from your phone.`,
  };
}

export default async function ShopCustomerPage({ params }: PageProps) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const shop = await getCachedShop(decodedSlug);

  if (!shop) {
    notFound();
  }

  const supabase = await createClient();
  const [categoriesRes, itemsRes] = await Promise.all([
    supabase
      .from("categories")
      .select("*")
      .eq("shop_id", shop.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("menu_items")
      .select("*")
      .eq("shop_id", shop.id)
      .eq("is_available", true)
      .order("sort_order", { ascending: true }),
  ]);

  const categories = (categoriesRes.data as Category[]) || [];
  const menuItems = (itemsRes.data as MenuItem[]) || [];

  return (
    <MenuCustomerPage shop={shop as Shop} categories={categories} menuItems={menuItems} />
  );
}
