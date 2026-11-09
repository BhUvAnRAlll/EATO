import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import { registrationApi, type Application, type MyRegistrations } from "@/lib/gymRegistration";

// Register your gym: the member's applications, read once by the overview and shared with the
// section screens. A save answers with the whole application, which replaces the one kept here.
type RegistrationLoad = { state: "loading" } | { state: "failed"; error: string; status?: number } | { state: "ready"; data: MyRegistrations };

type RegistrationState = {
  load: RegistrationLoad;
  read: (token: string | null) => Promise<void>;
  put: (app: Application) => void;
};

let running: Promise<void> | null = null;

export const useGymRegistration = create<RegistrationState>((set, get) => ({
  load: { state: "loading" },
  read: async (token) => {
    if (running) return running;
    running = (async () => {
      const answer = await registrationApi.mine(token);
      if (answer.ok) set({ load: { state: "ready", data: answer.data } });
      else if (get().load.state !== "ready") set({ load: { state: "failed", error: answer.error, status: answer.status } });
    })().finally(() => {
      running = null;
    });
    return running;
  },
  put: (app) =>
    set((state) => {
      if (state.load.state !== "ready") return state;
      const data = state.load.data;
      const summary = { id: app.id, gymName: app.gymName, branch: app.branch, city: app.city, status: app.status, statusLabel: app.statusLabel, statusNote: app.statusNote, submittedAt: app.submittedAt };
      const others = data.applications.filter((a) => a.id !== app.id);
      return { load: { state: "ready", data: { ...data, canStart: false, current: app, applications: [summary, ...others] } } };
    }),
}));

// Another account never sees this one's application
onAccountCleared(() => useGymRegistration.setState({ load: { state: "loading" } }));
