// The server selects the local calendar day; clients cannot choose a promotion date.
export const storeTimeZones=['America/Cuiaba','America/Sao_Paulo','America/Manaus','America/Rio_Branco','America/Noronha'];
export function pricingDay(timeZone='America/Cuiaba',now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(now);
 const value=type=>parts.find(p=>p.type===type).value;
 return {date:`${value('year')}-${value('month')}-${value('day')}`,saturday:value('weekday')==='Sat',timeZone};
}
export function productQuote(product,day){
 const p=product.fulfillment_pricing||{},base=Number(product.price_cents);
 let pickup=day.saturday&&p.saturdayPickupPrice!==undefined?Math.round(p.saturdayPickupPrice*100):base;
 let delivery=day.saturday&&p.saturdayDeliveryPrice!==undefined?Math.round(p.saturdayDeliveryPrice*100):p.deliveryPrice!==undefined?Math.round(p.deliveryPrice*100):pickup;
 const pickupOriginalCents=base,deliveryOriginalCents=p.deliveryPrice!==undefined?Math.round(p.deliveryPrice*100):base;
 if(p.promotionPickupPrice!==undefined)pickup=Math.min(pickup,Math.round(p.promotionPickupPrice*100));
 if(p.promotionDeliveryPrice!==undefined&&Math.round(p.promotionDeliveryPrice*100)<deliveryOriginalCents)delivery=Math.min(delivery,Math.round(p.promotionDeliveryPrice*100));
 return {pickupOriginalCents,deliveryOriginalCents,pickupCents:pickup,deliveryCents:delivery,deliveryIncluded:(p.promotionDeliveryPrice!==undefined&&Math.round(p.promotionDeliveryPrice*100)<deliveryOriginalCents)||p.deliveryPrice!==undefined||(day.saturday&&p.saturdayDeliveryPrice!==undefined),gasDoPovo:!!product.gas_do_povo,allowDelivery:!product.gas_do_povo||!!product.gas_do_povo_delivery};
}
export function basketShipping(items,fulfillment,normalFee){
 return fulfillment==='delivery'&&items.some(i=>!i.deliveryIncluded)?normalFee:0;
}
