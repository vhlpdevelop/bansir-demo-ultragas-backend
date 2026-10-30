import {httpError} from './database.js';
import {point,km} from './delivery-planner.js';
export function verifyDeliveryArea(config,location){
 const origin=point(config.location),radius=config.deliveryRadiusKm;
 if(!origin||!Number.isFinite(radius)||radius<=0)throw httpError(409,'A loja precisa configurar sua localização e o raio de entrega. Entre em contato ou escolha retirada.','DELIVERY_AREA_NOT_CONFIGURED');
 const destination=point(location);
 if(!destination||location.confirmed!==true||!Number.isFinite(location.accuracy)||location.accuracy>200)throw httpError(400,'Confirme no mapa o ponto exato do endereço de entrega (precisão até 200 m).','DELIVERY_POINT_REQUIRED');
 const distance=km(origin,destination);
 if(distance>radius)throw httpError(400,'O destino está fora da área de entrega deste estabelecimento. Escolha retirada ou procure uma loja mais próxima.','OUTSIDE_DELIVERY_AREA');
 return {distanceKm:distance,radiusKm:radius};
}
