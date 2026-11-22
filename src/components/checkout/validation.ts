/**
 * Buyer-side field validation for the checkout rebrand.
 * Nothing here is authoritative for money movement: the engine re-validates
 * the card (range + Luhn) and the OTP. These checks only give instant,
 * realistic form feedback. Everything starts EMPTY — no prefilled data.
 */

export interface InfoFields {
  email: string;
  firstName: string;
  lastName: string;
  street: string;
  city: string;
  postcode: string;
  country: string;
  shipDifferent: boolean;
  shipStreet: string;
  shipCity: string;
  shipPostcode: string;
  shipCountry: string;
}

export const EMPTY_INFO: InfoFields = {
  email: "",
  firstName: "",
  lastName: "",
  street: "",
  city: "",
  postcode: "",
  country: "",
  shipDifferent: false,
  shipStreet: "",
  shipCity: "",
  shipPostcode: "",
  shipCountry: ""
};

export interface CardFields {
  pan: string;
  name: string;
  exp: string;
  cvc: string;
}

export const EMPTY_CARD: CardFields = { pan: "", name: "", exp: "", cvc: "" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ErrorCode = "required" | "email" | "postcode" | "pan-format" | "exp-format" | "exp-past" | "cvc-format";

export function validateInfo(f: InfoFields): Partial<Record<keyof InfoFields, ErrorCode>> {
  const e: Partial<Record<keyof InfoFields, ErrorCode>> = {};
  if (!EMAIL_RE.test(f.email.trim())) e.email = "email";
  if (f.firstName.trim().length < 2) e.firstName = "required";
  if (f.lastName.trim().length < 2) e.lastName = "required";
  if (f.street.trim().length < 3) e.street = "required";
  if (f.city.trim().length < 2) e.city = "required";
  if (f.postcode.trim().length < 3) e.postcode = "postcode";
  if (!f.country) e.country = "required";
  if (f.shipDifferent) {
    if (f.shipStreet.trim().length < 3) e.shipStreet = "required";
    if (f.shipCity.trim().length < 2) e.shipCity = "required";
    if (f.shipPostcode.trim().length < 3) e.shipPostcode = "postcode";
    if (!f.shipCountry) e.shipCountry = "required";
  }
  return e;
}

/** Group digits in fours for display (input stays numeric-only underneath). */
export function formatPan(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Insert the MM/YY slash while typing. */
export function formatExp(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export function validateCardFormat(c: CardFields, now = new Date()): Partial<Record<keyof CardFields, ErrorCode>> {
  const e: Partial<Record<keyof CardFields, ErrorCode>> = {};
  const digits = c.pan.replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) e.pan = "pan-format";
  if (c.name.trim().length < 2) e.name = "required";
  const m = /^(\d{2})\/(\d{2})$/.exec(c.exp);
  if (!m) {
    e.exp = "exp-format";
  } else {
    const mm = Number(m[1]);
    if (mm < 1 || mm > 12) {
      e.exp = "exp-format";
    } else {
      const end = new Date(2000 + Number(m[2]), mm, 0, 23, 59, 59);
      if (end.getTime() < now.getTime()) e.exp = "exp-past";
    }
  }
  if (!/^\d{3,4}$/.test(c.cvc)) e.cvc = "cvc-format";
  return e;
}
