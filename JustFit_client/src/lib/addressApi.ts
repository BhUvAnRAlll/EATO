import { apiFetch, type ApiResult } from "@/lib/api";

// A member's delivery addresses (JustFit_server/addresses/, /api/addresses). The server keeps the
// selected address (isDefault), so the choice survives restarts and reinstalls, and decides from
// its pincode list whether justFit delivers there (deliverable).
export type AddressKind = "home" | "work" | "other";
export type DeliveryAddress = {
  id: number;
  kind: AddressKind;
  receiverName: string;
  receiverPhone: string; // 10 digits, +91 implied
  house: string;
  street: string;
  landmark: string | null;
  city: string | null;
  pincode: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  instructions: string | null;
  isDefault: boolean;
  deliverable: boolean;
  deliveryArea: string | null;
  updatedAt: string;
};
export type AddressBook = { addresses: DeliveryAddress[]; selectedId: number | null; max: number; savedId?: number };
export type AddressFields = {
  kind: AddressKind;
  receiverName: string;
  receiverPhone: string;
  house: string;
  street: string;
  landmark: string;
  city: string;
  pincode: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  instructions: string;
  makeDefault: boolean;
};
export type Serviceable = { pincode: string; deliverable: boolean; area: string | null };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });

export const addressApi = {
  list: (token: string | null) => (token ? apiFetch<AddressBook>("/api/addresses", { token }) : signedOut<AddressBook>()),
  create: (token: string | null, fields: AddressFields) =>
    token ? apiFetch<AddressBook>("/api/addresses", { token, method: "POST", body: fields }) : signedOut<AddressBook>(),
  update: (token: string | null, id: number, fields: AddressFields) =>
    token ? apiFetch<AddressBook>(`/api/addresses/${id}`, { token, method: "PUT", body: fields }) : signedOut<AddressBook>(),
  remove: (token: string | null, id: number) =>
    token ? apiFetch<AddressBook>(`/api/addresses/${id}`, { token, method: "DELETE" }) : signedOut<AddressBook>(),
  select: (token: string | null, id: number) =>
    token ? apiFetch<AddressBook>(`/api/addresses/${id}/default`, { token, method: "POST" }) : signedOut<AddressBook>(),
  serviceable: (token: string | null, pincode: string) =>
    token ? apiFetch<Serviceable>(`/api/addresses/serviceable?pincode=${encodeURIComponent(pincode)}`, { token }) : signedOut<Serviceable>(),
};
