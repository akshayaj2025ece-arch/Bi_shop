import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface EmployeeSession {
  employee_id: string;
  profile_id: string;
  full_name: string;
  phone: string;
  role: string;
  shop_id: string;
  shop_name: string;
  token?: string;
}

interface EmployeeStoreState {
  employee: EmployeeSession | null;
  setEmployee: (emp: EmployeeSession | null) => void;
  logoutEmployee: () => void;
}

export const useEmployeeStore = create<EmployeeStoreState>()(
  persist(
    (set) => ({
      employee: null,
      setEmployee: (employee) => set({ employee }),
      logoutEmployee: () => set({ employee: null }),
    }),
    {
      name: "bishop_employee_session",
    }
  )
);
