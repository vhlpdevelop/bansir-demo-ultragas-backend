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
 if(p.deliveryFeePerUnit!==undefined)delivery=pickup;
 return {deliveryFeePerUnitCents:p.deliveryFeePerUnit===undefined?null:Math.round(p.deliveryFeePerUnit*100),pickupOriginalCents,deliveryOriginalCents,pickupCents:pickup,deliveryCents:delivery,deliveryIncluded:p.deliveryFeePerUnit===undefined&&((p.promotionDeliveryPrice!==undefined&&Math.round(p.promotionDeliveryPrice*100)<deliveryOriginalCents)||p.deliveryPrice!==undefined||(day.saturday&&p.saturdayDeliveryPrice!==undefined)),gasDoPovo:!!product.gas_do_povo,allowDelivery:!product.gas_do_povo||!!product.gas_do_povo_delivery};
}
export function basketShipping(items,fulfillment,normalFee){
 if(fulfillment!=='delivery')return 0;
 const perItem=items.reduce((n,i)=>n+(i.deliveryFeePerUnitCents==null?0:i.deliveryFeePerUnitCents*i.quantity),0);
 return perItem+(items.some(i=>i.deliveryFeePerUnitCents==null&&!i.deliveryIncluded)?normalFee:0);
}
