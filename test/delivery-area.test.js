import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyDeliveryArea} from '../src/postgres/delivery-area.js';
const loja={latitude:-21.126,longitude:-56.484},local={latitude:-21.13,longitude:-56.48,accuracy:10,confirmed:true};
test('delivery radius belongs to the store and validates the confirmed destination',()=>{
 assert.ok(verifyDeliveryArea({location:loja,deliveryRadiusKm:5},local).distanceKm<1);
 assert.throws(()=>verifyDeliveryArea({location:loja,deliveryRadiusKm:5},{...local,latitude:-23.55,longitude:-46.63}),e=>e.code==='OUTSIDE_DELIVERY_AREA');
 for(const config of [{},{location:loja},{deliveryRadiusKm:5},{location:loja,deliveryRadiusKm:0}])assert.throws(()=>verifyDeliveryArea(config,local),e=>e.code==='DELIVERY_AREA_NOT_CONFIGURED');
 for(const point of [null,{...local,confirmed:false},{...local,accuracy:500},{...local,latitude:null}])assert.throws(()=>verifyDeliveryArea({location:loja,deliveryRadiusKm:5},point),e=>e.code==='DELIVERY_POINT_REQUIRED');
 assert.throws(()=>verifyDeliveryArea({location:loja,deliveryRadiusKm:.1},local),e=>e.code==='OUTSIDE_DELIVERY_AREA');
});
