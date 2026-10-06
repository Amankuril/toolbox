import { ShippingProviderError } from '../../shipping.errors.js';
import { createShipmozoClient } from './client.js';
import { ENDPOINTS } from './constants.js';
import { parseRates, parseTracking, parseWarehouse, pushOrderBody, pushReturnOrderBody, rateCalculatorBody } from './mapper.js';

const str = (v) => (v === undefined || v === null || v === '' ? null : String(v));

/**
 * Shipmozo implementation of the shipping provider interface. Only endpoints documented in the
 * Shipmozo API guide are used. Inputs/outputs are provider-neutral (see ../../shipping.provider.js).
 */
export function createShipmozoProvider(config) {
  const http = createShipmozoClient(config);

  return {
    name: 'shipmozo',

    async info() {
      return http.get(ENDPOINTS.info);
    },

    async serviceability({ pickupPincode, deliveryPincode }) {
      const data = await http.post(ENDPOINTS.pincodeServiceability, {
        pickup_pincode: Number(pickupPincode),
        delivery_pincode: Number(deliveryPincode),
      });
      return { serviceable: data?.serviceable === true || data?.serviceable === 'true' || data?.serviceable === 1 };
    },

    async rates(quote) {
      return parseRates(await http.post(ENDPOINTS.rateCalculator, rateCalculatorBody(quote)));
    },

    async pushOrder(shipment) {
      const data = await http.post(ENDPOINTS.pushOrder, pushOrderBody(shipment));
      return { providerOrderId: str(data?.order_id) ?? shipment.providerOrderId, referenceId: str(data?.reference_id) };
    },

    async pushReturnOrder(shipment) {
      const data = await http.post(ENDPOINTS.pushReturnOrder, pushReturnOrderBody(shipment));
      return { providerOrderId: str(data?.order_id) ?? shipment.providerOrderId, referenceId: str(data?.reference_id) };
    },

    /** True when Shipmozo already has this order id (used to verify a push whose outcome is unknown). */
    async orderExists(providerOrderId) {
      try {
        await http.get(ENDPOINTS.orderDetail(providerOrderId));
        return true;
      } catch (err) {
        if (err instanceof ShippingProviderError && err.kind === 'rejected') return false;
        throw err;
      }
    },

    async assignCourier({ providerOrderId, courierId }) {
      const data = await http.post(ENDPOINTS.assignCourier, { order_id: providerOrderId, courier_id: Number(courierId) });
      return { courier: str(data?.courier), awbNumber: str(data?.awb_number), referenceId: str(data?.reference_id) };
    },

    async autoAssign({ providerOrderId }) {
      const data = await http.post(ENDPOINTS.autoAssignOrder, { order_id: providerOrderId });
      return {
        courier: str(data?.courier_company),
        courierService: str(data?.courier_company_service),
        awbNumber: str(data?.awb_number),
        referenceId: str(data?.reference_id),
      };
    },

    async schedulePickup({ providerOrderId }) {
      const data = await http.post(ENDPOINTS.schedulePickup, { order_id: providerOrderId });
      return { courier: str(data?.courier), awbNumber: str(data?.awb_number), lrNumber: str(data?.lr_number) };
    },

    async cancel({ providerOrderId, awbNumber }) {
      // Documented as a number; AWBs with letters are sent as-is.
      const awb = /^\d+$/.test(awbNumber) && Number.isSafeInteger(Number(awbNumber)) ? Number(awbNumber) : awbNumber;
      await http.post(ENDPOINTS.cancelOrder, { order_id: providerOrderId, awb_number: awb });
      return { cancelled: true };
    },

    async track(awbNumber) {
      return parseTracking(await http.get(ENDPOINTS.trackOrder, { query: { awb_number: awbNumber } }));
    },

    /** Returns the label as PNG bytes; never persisted (it can be fetched again by AWB). */
    async label(awbNumber) {
      const data = await http.get(ENDPOINTS.orderLabel(awbNumber));
      const entry = Array.isArray(data) ? data[0] : data;
      const match = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(entry?.label ?? '');
      if (!match) throw new ShippingProviderError('invalid_response', 'Shipmozo label response had no image', { operation: 'GET /get-order-label' });
      return { contentType: match[1], buffer: Buffer.from(match[2], 'base64'), createdAt: entry.created_at ?? null };
    },

    async returnReasons() {
      const data = await http.get(ENDPOINTS.returnReasons);
      return (Array.isArray(data) ? data : []).map((r) => ({ id: Number(r.id), title: String(r.title ?? '') })).filter((r) => r.id);
    },

    async warehouses() {
      const data = await http.get(ENDPOINTS.warehouses);
      return (Array.isArray(data) ? data : []).map(parseWarehouse);
    },

    /** Shipmozo returns the existing id when `title` was used before, which makes this idempotent. */
    async createWarehouse({ title, name, phone, email, address }) {
      const data = await http.post(ENDPOINTS.createWarehouse, {
        address_title: title,
        name,
        phone: Number(String(phone ?? '').replace(/\D/g, '').slice(-10)) || undefined,
        email,
        address_line_one: address.line1,
        address_line_two: [address.line2, address.landmark].filter(Boolean).join(', '),
        pin_code: Number(address.pincode),
      });
      const id = str(data?.warehouse_id);
      if (!id) throw new ShippingProviderError('invalid_response', 'Shipmozo did not return a warehouse id', { operation: 'POST /create-warehouse' });
      return { warehouseId: id };
    },

    async updateOrderWarehouse({ providerOrderId, warehouseId }) {
      await http.post(ENDPOINTS.updateOrderWarehouse, { order_id: providerOrderId, warehouse_id: Number(warehouseId) });
      return { updated: true };
    },
  };
}
