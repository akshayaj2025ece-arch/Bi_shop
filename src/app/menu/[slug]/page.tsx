import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import MenuCustomerPage from "./MenuCustomerPage";
import type { Category, MenuItem, Shop } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Deduplicate shop queries between metadata generation and page render
const getCachedMenuShop = cache(async (decodedSlug: string) => {
  const supabase = await createClient();
  let { data: shop } = await supabase
    .from("shops")
    .select("*")
    .eq("id", decodedSlug)
    .maybeSingle();

  if (!shop) {
    const { data: fallbackShop } = await supabase
      .from("shops")
      .select("*")
      .or(`slug.eq.${decodedSlug},name.ilike.${decodedSlug}`)
      .limit(1)
      .maybeSingle();
    shop = fallbackShop;
  }
  return shop as Shop | null;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const shop = await getCachedMenuShop(decodedSlug);

  const shopName = shop?.name || (shop as any)?.shop_name || "Shop";

  if (!shop) {
    return {
      title: "Menu Not Found | BISHOP",
    };
  }

  return {
    title: `${shopName} Digital Menu | BISHOP`,
    description: `Browse the ${shopName} menu and place an order directly from your phone.`,
  };
}

export default async function MenuPage({ params }: PageProps) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const shop = await getCachedMenuShop(decodedSlug);

  if (!shop) {
    notFound();
  }

  const supabase = await createClient();
  const [categoriesRes, itemsRes, inventoryRes] = await Promise.all([
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
      .order("sort_order", { ascending: true }),
    supabase
      .from("inventory")
      .select("*")
      .eq("shop_id", shop.id),
  ]);

  let categories = (categoriesRes.data as Category[]) || [];
  let rawMenuItems = (itemsRes.data as MenuItem[]) || [];
  let inventoryItems = inventoryRes.data || [];

  const inventoryMap = new Map<string, number>();
  inventoryItems.forEach((inv: any) => {
    if (inv.name) {
      inventoryMap.set(inv.name.trim().toLowerCase(), inv.quantity ?? 0);
    }
  });

  let menuItems: MenuItem[] = rawMenuItems.map((item) => {
    const key = item.name.trim().toLowerCase();
    const qty = inventoryMap.has(key) ? inventoryMap.get(key) : (item.quantity ?? 10);
    return {
      ...item,
      quantity: qty,
      is_available: (qty ?? 10) > 0 ? item.is_available : false,
    };
  });

  if (categories.length === 0) {
    categories = [
      {
        id: "cat-1",
        shop_id: shop.id,
        name: "Fresh Bakery & Delights",
        description: "Oven-fresh cakes, golden puffs & baked goods",
        sort_order: 1,
        is_active: true,
        created_at: new Date().toISOString(),
      },
      {
        id: "cat-2",
        shop_id: shop.id,
        name: "Hot Meals & Main Course",
        description: "Authentic biriyani, fried rice & traditional meals",
        sort_order: 2,
        is_active: true,
        created_at: new Date().toISOString(),
      },
      {
        id: "cat-3",
        shop_id: shop.id,
        name: "Beverages & Teas",
        description: "South Indian filter coffee, chai & cold drinks",
        sort_order: 3,
        is_active: true,
        created_at: new Date().toISOString(),
      },
    ] as any[];

    menuItems = [
      {
        id: "item-1",
        shop_id: shop.id,
        category_id: "cat-1",
        name: "Fresh Chocolate Cake",
        description: "Rich chocolate sponge with chocolate fudge icing",
        price: 350,
        image_url: "/hero/cake.webp",
        is_veg: true,
        is_available: true,
        sort_order: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: "item-2",
        shop_id: shop.id,
        category_id: "cat-1",
        name: "Crispy Egg Puff",
        description: "Flaky golden puff pastry with spiced egg filling",
        price: 35,
        image_url: "/hero/puff.webp",
        is_veg: false,
        is_available: true,
        sort_order: 2,
        created_at: new Date().toISOString(),
      },
      {
        id: "item-3",
        shop_id: shop.id,
        category_id: "cat-2",
        name: "Special Chicken Biriyani",
        description: "Aromatic basmati rice cooked with authentic spices",
        price: 220,
        image_url: "/hero/biriyani.webp",
        is_veg: false,
        is_available: true,
        sort_order: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: "item-4",
        shop_id: shop.id,
        category_id: "cat-2",
        name: "South Indian Special Meals",
        description: "Traditional thali with rice, sambar, rasam & kootu",
        price: 120,
        image_url: "/hero/meals.webp",
        is_veg: true,
        is_available: true,
        sort_order: 2,
        created_at: new Date().toISOString(),
      },
      {
        id: "item-5",
        shop_id: shop.id,
        category_id: "cat-3",
        name: "Degree Filter Coffee",
        description: "Hot authentic South Indian filter coffee",
        price: 30,
        image_url: "/hero/filtercoffee.webp",
        is_veg: true,
        is_available: true,
        sort_order: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: "item-6",
        shop_id: shop.id,
        category_id: "cat-3",
        name: "Masala Chai Tea",
        description: "Brewed black tea with aromatic cardamom & spices",
        price: 25,
        image_url: "/hero/tea.webp",
        is_veg: true,
        is_available: true,
        sort_order: 2,
        created_at: new Date().toISOString(),
      },
    ] as any[];
  }

  return (
    <MenuCustomerPage shop={shop as Shop} categories={categories} menuItems={menuItems} />
  );
}
