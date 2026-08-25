export interface NominatimAddress {
  house_number?: string;
  road?: string;
  suburb?: string;
  neighbourhood?: string;
  city_district?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

export interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: NominatimAddress;
}

export interface GeocodeResult {
  display_name: string;
  lat: number;
  lng: number;
  street: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
}

export function normaliseGeocodeResult(r: NominatimResult): GeocodeResult {
  const a = r.address ?? {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const suburb = a.suburb || a.neighbourhood || a.city_district || a.city || a.town || a.village || "";
  return {
    display_name: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
    street,
    suburb,
    state: a.state ?? "",
    postcode: a.postcode ?? "",
    country: a.country ?? "",
  };
}
