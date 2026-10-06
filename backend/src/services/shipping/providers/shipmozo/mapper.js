import { toPaise, toRupees } from '#core/utils/money.js';
import {
  DEFAULT_ORDER_TYPE,
  DEFAULT_PACKAGE_TYPE,
  DEFAULT_ROV_TYPE,
  PAYMENT_TYPE,
  SHIPMENT_TYPE,
  TRACKING_STATUS_RULES,
} from './constants.js';

/**
 * Translates between the app's provider-neutral shapes and Shipmozo's request/response bodies.
 * Amounts arrive in paise and leave in rupees; phones arrive as +91XXXXXXXXXX and leave as 10 digits.
 */

const phoneNumber = (phone) => Number(String(phone ?? '').replace(/\D/g, '').slice(-10)) || undefined;
const pin = (pincode) => Number(pincode);
const ymd = (date) => new Date(date).toISOString().slice(0, 10);

function productDetail(items) {
  return items.map((i) => ({
    name: i.name.slice(0, 200),
    sku_number: i.sku ?? '',
    quantity: i.quantity,
    discount: '',
    hsn: i.hsnCode ?? '',
    unit_price: toRupees(i.unitPrice),
    product_category: 'Other',
  }));
}

/** Forward shipment: seller warehouse → customer. */
export function pushOrderBody(s) {
  const cod = s.paymentType === 'cod';
  const address = s.consignee.address;
  return {
    order_id: s.providerOrderId,
    order_date: ymd(s.orderDate),
    order_type: DEFAULT_ORDER_TYPE,
    consignee_name: s.consignee.name,
    consignee_phone: phoneNumber(s.consignee.phone),
    consignee_email: s.consignee.email ?? '',
    consignee_address_line_one: address.line1,
    consignee_address_line_two: [address.line2, address.landmark].filter(Boolean).join(', '),
    consignee_pin_code: pin(address.pincode),
    consignee_city: address.city,
    consignee_state: address.state,
    product_detail: productDetail(s.items),
    payment_type: cod ? PAYMENT_TYPE.cod : PAYMENT_TYPE.prepaid,
    // Only COD shipments carry an amount to collect.
    cod_amount: cod ? String(toRupees(s.codAmount)) : '',
    weight: s.package.weightGrams,
    length: s.package.lengthCm,
    width: s.package.widthCm,
    height: s.package.heightCm,
    warehouse_id: String(s.warehouseId),
    gst_ewaybill_number: '',
    gstin_number: s.gstin ?? '',
  };
}

/** Return pickups come from the customer; Shipmozo documents return weight in kg (forward is grams). */
export function pushReturnOrderBody(s) {
  const address = s.pickup.address;
  return {
    order_id: s.providerOrderId,
    order_date: ymd(s.orderDate),
    order_type: DEFAULT_ORDER_TYPE,
    pickup_name: s.pickup.name,
    pickup_phone: phoneNumber(s.pickup.phone),
    pickup_email: s.pickup.email ?? '',
    pickup_address_line_one: address.line1,
    pickup_address_line_two: [address.line2, address.landmark].filter(Boolean).join(', '),
    pickup_pin_code: pin(address.pincode),
    pickup_city: address.city,
    pickup_state: address.state,
    product_detail: productDetail(s.items),
    payment_type: PAYMENT_TYPE.prepaid,
    weight: Math.max(0.01, Math.round(s.package.weightGrams / 10) / 100),
    length: s.package.lengthCm,
    width: s.package.widthCm,
    height: s.package.heightCm,
    warehouse_id: s.warehouseId ? String(s.warehouseId) : '',
    return_reason_id: s.returnReasonId,
    customer_request: s.customerRequest,
    reason_comment: s.reasonComment ?? '',
  };
}

export function rateCalculatorBody(q) {
  const cod = q.paymentType === 'cod';
  return {
    order_id: q.providerOrderId ?? '',
    pickup_pincode: pin(q.pickupPincode),
    delivery_pincode: pin(q.deliveryPincode),
    payment_type: cod ? PAYMENT_TYPE.cod : PAYMENT_TYPE.prepaid,
    shipment_type: q.shipmentType === 'return' ? SHIPMENT_TYPE.return : SHIPMENT_TYPE.forward,
    order_amount: toRupees(q.orderAmount),
    type_of_package: DEFAULT_PACKAGE_TYPE,
    rov_type: DEFAULT_ROV_TYPE,
    cod_amount: cod ? String(toRupees(q.codAmount ?? q.orderAmount)) : '',
    weight: q.package.weightGrams,
    dimensions: [{ no_of_box: '1', length: String(q.package.lengthCm), width: String(q.package.widthCm), height: String(q.package.heightCm) }],
  };
}

const pick = (obj, keys) => keys.map((k) => obj?.[k]).find((v) => v !== undefined && v !== null && v !== '');
const yesNo = (v) => (typeof v === 'string' ? v.trim().toUpperCase() === 'YES' : typeof v === 'boolean' ? v : undefined);

/**
 * The guide documents the rate-calculator request but not its response, except that it carries
 * the courier id used by assign-courier and `pickups_automatically_scheduled`. Field names are
 * therefore read defensively; anything we can't identify is dropped rather than guessed.
 */
export function parseRates(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.couriers) ? data.couriers : [];
  return list
    .map((r) => {
      const courierId = Number(pick(r, ['courier_id', 'id']));
      if (!Number.isFinite(courierId) || courierId <= 0) return null;
      const total = Number(pick(r, ['total_charges', 'total_charge', 'total', 'rate', 'charges', 'amount']));
      return {
        courierId,
        name: String(pick(r, ['name', 'courier_name', 'courier', 'courier_company']) ?? `Courier ${courierId}`).slice(0, 120),
        service: pick(r, ['courier_company_service', 'service', 'service_name']) ?? null,
        charge: Number.isFinite(total) ? toPaise(total) : null,
        estimatedDelivery: pick(r, ['estimated_delivery', 'expected_delivery_date', 'edd', 'delivery_days']) ?? null,
        pickupsAutomaticallyScheduled: yesNo(r.pickups_automatically_scheduled) ?? null,
      };
    })
    .filter(Boolean);
}

export function mapTrackingStatus(text) {
  if (!text) return null;
  return TRACKING_STATUS_RULES.find(([re]) => re.test(text))?.[1] ?? null;
}

export function parseTracking(data) {
  const scans = Array.isArray(data?.scan_detail) ? data.scan_detail : [];
  return {
    awbNumber: data?.awb_number ? String(data.awb_number) : null,
    courier: data?.courier ?? null,
    currentStatus: data?.current_status ?? null,
    status: mapTrackingStatus(data?.current_status),
    statusTime: data?.status_time ?? null,
    expectedDeliveryDate: data?.expected_delivery_date ?? null,
    // Scan rows are undocumented; keep a bounded, string-only copy.
    scans: scans.slice(0, 100).map((s) => ({
      status: String(pick(s, ['status', 'scan_status', 'activity', 'remark']) ?? '').slice(0, 200),
      location: String(pick(s, ['location', 'scan_location', 'city']) ?? '').slice(0, 120),
      at: String(pick(s, ['date', 'time', 'scan_time', 'status_time', 'created_at']) ?? '').slice(0, 40),
    })),
  };
}

export function parseWarehouse(w) {
  return {
    id: String(w.id),
    isDefault: w.default === 'YES',
    title: w.address_title ?? '',
    name: w.name ?? '',
    phone: w.phone ?? '',
    addressLineOne: w.address_line_one ?? '',
    addressLineTwo: w.address_line_two ?? '',
    pincode: w.pincode ? String(w.pincode) : '',
    city: w.city ?? '',
    state: w.state ?? '',
    status: w.status ?? '',
  };
}
