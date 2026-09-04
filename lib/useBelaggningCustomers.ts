"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { newProject, type CapacityReservation, type CustomerData, type HourAllocation, type PricingType } from "./sections";
import {
  fetchAllCustomers,
  fetchDataVersion,
  saveCustomer,
  subscribeToCustomerChanges,
} from "./customersClient";
import { showToast } from "@/components/Toast";
import type { HourAllocationDraft } from "@/components/BelaggningAllocPopover";

/**
 * Delad datahantering för beläggningsvyn: laddar alla kunder, lyssnar på
 * Realtime så andras sparningar syns, och sparar timallokeringar direkt
 * (utan debounce — det är en post i taget).
 *
 * `epoch` räknas upp varje gång serverdatan ändrats, så vyer som hämtar från
 * `/api/belaggning` vet när de ska hämta om.
 */
export function useBelaggningCustomers() {
  const [customers, setCustomers] = useState<Record<string, CustomerData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const dataVersionRef = useRef<string | null>(null);
  const savingRef = useRef(false);

  const load = useCallback(async (mode: "initial" | "silent" = "silent") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    try {
      const all = await fetchAllCustomers();
      setCustomers(all);
      setError(null);
      const version = await fetchDataVersion();
      if (version) dataVersionRef.current = version.version;
      setEpoch((n) => n + 1);
    } catch (err) {
      if (mode === "initial") setError(String(err));
    } finally {
      if (mode === "initial") setLoading(false);
      else setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load("initial");
  }, [load]);

  // Auto-uppdatering via Supabase Realtime (annan flik, kollega, Codex via
  // API:t) + vid fokus. Egen pågående save hoppar över omladdningen.
  useEffect(() => {
    const unsubscribe = subscribeToCustomerChanges(() => {
      if (!savingRef.current) void load("silent");
    });
    function onFocus() {
      if (!savingRef.current) load("silent");
    }
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  /** Sparar en ändrad kund direkt och räknar upp `epoch`. */
  const persist = useCallback(async (slug: string, next: CustomerData) => {
    savingRef.current = true;
    setCustomers((prev) => ({ ...prev, [slug]: next }));
    try {
      const saved = await saveCustomer(slug, next);
      if (!saved) {
        showToast("Kunde inte spara");
        return;
      }
      const version = await fetchDataVersion();
      if (version) dataVersionRef.current = version.version;
      setEpoch((n) => n + 1);
    } catch {
      showToast("Kunde inte spara");
    } finally {
      savingRef.current = false;
    }
  }, []);

  /**
   * Skapar eller uppdaterar en timallokering. Vid redigering (`replace`)
   * tas den gamla posten bort där den låg — även om det är hos en annan
   * kund — och den nya läggs på valt projekt.
   */
  const saveHourAllocation = useCallback(
    (draft: HourAllocationDraft) => {
      const target = customers[draft.customerSlug];
      if (!target) return;
      const replace = draft.replace;
      const allocation = draft.allocation as HourAllocation;

      const withoutOld = (c: CustomerData, projectId: string): CustomerData => ({
        ...c,
        projects: c.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                hourAllocations: (p.hourAllocations ?? []).filter(
                  (a) => a.id !== allocation.id,
                ),
              }
            : p,
        ),
      });

      const withNew = (c: CustomerData): CustomerData => ({
        ...c,
        projects: c.projects.map((p) => {
          if (p.id !== draft.projectId) return p;
          const list = p.hourAllocations ?? [];
          const idx = list.findIndex((a) => a.id === allocation.id);
          return {
            ...p,
            pricingType: draft.pricingType as PricingType,
            hourAllocations:
              idx >= 0
                ? list.map((a) => (a.id === allocation.id ? allocation : a))
                : [...list, allocation],
          };
        }),
      });

      if (replace && replace.customerSlug !== draft.customerSlug) {
        const old = customers[replace.customerSlug];
        if (old) void persist(replace.customerSlug, withoutOld(old, replace.projectId));
        void persist(draft.customerSlug, withNew(target));
        return;
      }
      const base =
        replace && replace.projectId !== draft.projectId
          ? withoutOld(target, replace.projectId)
          : target;
      void persist(draft.customerSlug, withNew(base));
    },
    [customers, persist],
  );

  const removeHourAllocation = useCallback(
    (slug: string, projectId: string, allocationId: string) => {
      const c = customers[slug];
      if (!c) return;
      const next: CustomerData = {
        ...c,
        projects: c.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                hourAllocations: (p.hourAllocations ?? []).filter(
                  (a) => a.id !== allocationId,
                ),
              }
            : p,
        ),
      };
      void persist(slug, next);
    },
    [customers, persist],
  );

  const saveCapacityReservation = useCallback(
    (slug: string, projectId: string, reservation: CapacityReservation) => {
      const c = customers[slug];
      if (!c) return;
      const next: CustomerData = {
        ...c,
        projects: c.projects.map((p) => {
          if (p.id !== projectId) return p;
          const list = p.capacityReservations ?? [];
          const exists = list.some((r) => r.id === reservation.id);
          return {
            ...p,
            capacityReservations: exists
              ? list.map((r) => r.id === reservation.id ? reservation : r)
              : [...list, reservation],
          };
        }),
      };
      void persist(slug, next);
    },
    [customers, persist],
  );

  const removeCapacityReservation = useCallback(
    (slug: string, projectId: string, reservationId: string) => {
      const c = customers[slug];
      if (!c) return;
      void persist(slug, {
        ...c,
        projects: c.projects.map((p) => p.id === projectId ? {
          ...p,
          capacityReservations: (p.capacityReservations ?? []).filter((r) => r.id !== reservationId),
        } : p),
      });
    },
    [customers, persist],
  );

  const createCustomer = useCallback(async (client: string) => {
    const name = client.trim();
    if (!name) return null;
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: name }),
      });
      if (!res.ok) throw new Error("create failed");
      const saved = await res.json() as { slug: string; data: CustomerData };
      setCustomers((prev) => ({ ...prev, [saved.slug]: saved.data }));
      return saved.slug;
    } catch {
      showToast("Kunde inte skapa kund");
      return null;
    }
  }, []);

  const createProject = useCallback(async (slug: string, name: string) => {
    const customer = customers[slug];
    const projectName = name.trim();
    if (!customer || !projectName) return false;
    const project = newProject(projectName);
    await persist(slug, {
      ...customer,
      projects: [...customer.projects, project],
      activeProjectId: project.id,
    });
    return true;
  }, [customers, persist]);

  return {
    customers,
    loading,
    error,
    refreshing,
    epoch,
    load,
    saveHourAllocation,
    removeHourAllocation,
    saveCapacityReservation,
    removeCapacityReservation,
    createCustomer,
    createProject,
  };
}
