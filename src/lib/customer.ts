import { createClient } from "@/lib/supabase/client";
import type { CustomerProfile } from "@/stores/customer-store";

/**
 * Saves or updates a customer profile in Supabase Auth metadata and profiles table.
 */
export async function saveCustomerProfileToSupabase(
  profile: CustomerProfile
): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.log("[BISHOP Customer] No authenticated Supabase user found when saving profile.");
      return false;
    }

    // Check existing profile role before overriding role
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const currentRole = existingProfile?.role;
    const isPrivileged = currentRole === "shopkeeper" || currentRole === "employee";

    // 1. Update Supabase Auth user_metadata
    // Store customer_profile data without corrupting the shopkeeper's or employee's primary identity
    const metaPayload: Record<string, any> = {
      customer_profile: profile,
    };
    if (!isPrivileged) {
      metaPayload.role = "customer";
      metaPayload.full_name = profile.name;
    }

    const { error: metaError } = await supabase.auth.updateUser({
      data: metaPayload,
    });

    if (metaError) {
      console.warn("[BISHOP Customer] Warning updating auth user_metadata:", metaError);
    }

    // 2. Only modify the public profiles table if the user is a standard customer
    if (!isPrivileged) {
      const profilePayload = {
        id: user.id,
        email: user.email || "",
        full_name: profile.name,
        phone: profile.phone || null,
        role: "customer",
        updated_at: new Date().toISOString(),
      };

      const { error: dbError } = await supabase
        .from("profiles")
        .upsert(profilePayload);

      if (dbError) {
        console.warn("[BISHOP Customer] Warning upserting profile in database:", dbError);
      }
    }

    console.log("[BISHOP Customer] Profile linked and saved for Supabase User ID:", user.id);
    return true;
  } catch (err) {
    console.error("[BISHOP Customer] Exception saving customer profile to Supabase:", err);
    return false;
  }
}

/**
 * Fetches and restores an existing customer profile from Supabase Auth user_metadata or profiles table.
 */
export async function fetchCustomerProfileFromSupabase(): Promise<CustomerProfile | null> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    // 1. Check user_metadata for saved customer_profile object
    const metaProfile = user.user_metadata?.customer_profile as CustomerProfile | undefined;

    if (metaProfile && metaProfile.name && (metaProfile.locationAddress || metaProfile.latitude)) {
      return metaProfile;
    }

    // 2. Fallback: Check profiles database table for role = 'customer' or existing record
    const { data: dbProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (dbProfile && (dbProfile.full_name || dbProfile.role === "customer")) {
      const restored: CustomerProfile = {
        name: dbProfile.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Customer",
        phone: dbProfile.phone || dbProfile.phone_number || "",
        locationAddress: user.user_metadata?.customer_profile?.locationAddress || "Current Position",
        latitude: user.user_metadata?.customer_profile?.latitude ?? null,
        longitude: user.user_metadata?.customer_profile?.longitude ?? null,
        locationEnabled: Boolean(user.user_metadata?.customer_profile?.latitude),
        updatedAt: dbProfile.updated_at || new Date().toISOString(),
      };
      return restored;
    }

    return null;
  } catch (err) {
    console.error("[BISHOP Customer] Exception fetching customer profile from Supabase:", err);
    return null;
  }
}
