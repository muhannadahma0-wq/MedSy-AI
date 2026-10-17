import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { apiClient } from "../services/api/client";

const MedicineContext = createContext();

export const useMedicine = () => useContext(MedicineContext);

export const MedicineProvider = ({ children }) => {
  /**
   * IMPORTANT SECURITY NOTE:
   * - We do NOT trust localStorage for identity
   * - localuser is used ONLY for UI convenience
   * - Backend MUST derive user from auth (JWT/session)
   */
  const [localuser, setLocaluser] = useState(() => {
    try {
      const stored = localStorage.getItem("user");
      if (!stored || stored === "undefined") return null;
      return JSON.parse(stored);
    } catch {
      return null;
    }
  });

  // Sandbox port fix: the provider mounts before login, so re-read the stored
  // user whenever the auth session changes (login/verify pages dispatch this).
  useEffect(() => {
    const refreshUser = () => {
      try {
        const stored = localStorage.getItem("user");
        if (!stored || stored === "undefined") {
          setLocaluser(null);
          return;
        }
        setLocaluser(JSON.parse(stored));
      } catch {
        setLocaluser(null);
      }
    };
    window.addEventListener("medsync-auth-changed", refreshUser);
    return () => window.removeEventListener("medsync-auth-changed", refreshUser);
  }, []);

  const [medication, setMedication] = useState({
    pillName: "",
    pillDescription: "",
    dosageDays: [],
    dosageTimes: [],
    dosageAmount: "",
    frequency: "",
    startDate: new Date().toISOString().split("T")[0],
    endDate: "",
  });

  /**
   * ADD MEDICATION
   * - No userId sent
   * - Backend infers user from auth
   */
  const addMedication = useCallback(async () => {
    if (!localuser) return;

    return apiClient({
      url: "/api/medicine/add",
      method: "POST",
      body: {
        medication,
      },
      actionType: "ADD_MEDICATION",
    });
  }, [medication, localuser]);

  /**
   * FETCH TODAY'S MEDICATION
   * - Auth handled by apiClient
   * - No identity in payload
   */
  const todayMedication = useCallback(async () => {
    if (!localuser) return [];

    return apiClient({
      url: "/api/medicine/today",
      method: "POST",
      body: {},
      actionType: "FETCH_TODAY_MEDICATION",
    });
  }, [localuser]);

  /**
   * UPDATE MEDICATION STATUS (OFFLINE SAFE)
   * - Stores INTENT only
   * - No userId
   * - No frontend timestamps
   */
  const medicineStatus = useCallback(
    async (medId, status) => {
      if (!localuser) return;

      return apiClient({
        url: "/api/medicine/status",
        method: "POST",
        body: {
          medId,
          status,
        },
        actionType: "UPDATE_MEDICATION_STATUS",
      });
    },
    [localuser]
  );

  /**
   * FETCH ALL MEDICATIONS (management view)
   * - Every medication of the caller, not just today's regimen
   * - Auth handled by apiClient; no identity in payload
   */
  const fetchAllMedications = useCallback(async () => {
    if (!localuser) return [];

    return apiClient({
      url: "/api/medicine/list",
      method: "POST",
      body: {},
      actionType: "FETCH_ALL_MEDICATIONS",
    });
  }, [localuser]);

  /**
   * DELETE MEDICATION (online-only by design)
   * - Removing a regimen also removes its tracked dose history — an explicit
   *   user decision that must NOT be replayed silently from the offline queue,
   *   so the actionType is intentionally outside the replayable set.
   */
  const deleteMedication = useCallback(
    async (medId) => {
      if (!localuser) return;

      return apiClient({
        url: "/api/medicine/delete",
        method: "POST",
        body: { medId },
        actionType: "DELETE_MEDICATION",
      });
    },
    [localuser]
  );

  /**
   * FETCH STREAK DAYS
   * - Correct nullish handling
   * - No identity in payload
   */
  const getStreakDays = useCallback(async () => {
    if (!localuser) return 0;

    const response = await apiClient({
      url: "/api/streak",
      method: "POST",
      body: {},
      actionType: "FETCH_STREAK",
    });

    return response?.streakDays ?? 0;
  }, [localuser]);

  return (
    <MedicineContext.Provider
      value={{
        medication,
        setMedication,
        addMedication,
        todayMedication,
        medicineStatus,
        getStreakDays,
        fetchAllMedications,
        deleteMedication,
      }}
    >
      {children}
    </MedicineContext.Provider>
  );
};
