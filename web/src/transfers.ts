import { create } from "zustand";
export type TransferSnapshot = {
  id: string;
  name: string;
  connectionID: string;
  hostName: string;
  direction: "upload" | "download";
  status: "uploading" | "done" | "failed" | "cancelled";
  progress: number;
  speed: number;
  error?: string;
  cancel: () => void;
  retry: () => void;
};
export const useTransfers = create<{
  byConnection: Record<string, TransferSnapshot[]>;
  update: (id: string, items: TransferSnapshot[]) => void;
  remove: (id: string) => void;
}>((set) => ({
  byConnection: {},
  update: (id, items) =>
    set((state) => ({ byConnection: { ...state.byConnection, [id]: items } })),
  remove: (id) =>
    set((state) => {
      const next = { ...state.byConnection };
      delete next[id];
      return { byConnection: next };
    }),
}));
