/*CORE*/
import {Routes} from '@angular/router';
/*COMPONENTS*/
import {BlockComponent} from '../scenes/block/block.component';
import {TransactionComponent} from '../scenes/transaction/transaction.component';
import {AddressComponent} from '../scenes/address/address.component';
import {RichlistComponent} from '../scenes/richlist/richlist.component';
import {HomeComponent} from '../scenes/home/home.component';
import {PageNotFoundComponent} from '../scenes/page-not-found/page-not-found.component';
import {ContractComponent} from '../scenes/contract/contract.component';
import {TokenAssetComponent} from '../scenes/token-asset/token-asset.component';
// import {SettingsComponent} from '../scenes/settings/settings.component';
/*SERVICES*/
import {CommonService} from '../services/common.service';
/*UTILS*/
import {ROUTES} from './constants';

export const APP_ROUTES: Routes = [
  {
    path: 'wallet',
    loadChildren: './modules/wallet/wallet.module#WalletModule',
    resolve: {rpcProvider: CommonService},
  },
  {path: ROUTES.BLOCK + '/:id', component: BlockComponent},
  {
    path: ROUTES.TRANSACTION + '/:id',
    component: TransactionComponent,
    resolve: {rpcProvider: CommonService},
  },
  {
    path: ROUTES.ADDRESS_FULL + '/:id',
    component: AddressComponent,
    resolve: {rpcProvider: CommonService},
  },
  {
    path: ROUTES.ADDRESS + '/:id',
    component: AddressComponent,
    resolve: {rpcProvider: CommonService},
  },
  {
    path: ROUTES.TOKEN + '/:id',
    component: AddressComponent,
    resolve: {rpcProvider: CommonService},
  },
  {
    path: ROUTES.TOKEN + '/:id/asset/:tokenId',
    component: TokenAssetComponent,
    resolve: {rpcProvider: CommonService},
  },
  {path: ROUTES.VERIFY, component: ContractComponent},
  {path: ROUTES.RICHLIST, component: RichlistComponent},
  /*{path: ROUTES.SETTINGS, component: SettingsComponent},*/
  {path: ROUTES.HOME, component: HomeComponent},
  {path: '', pathMatch: 'full', redirectTo: 'home'},
  {path: '**', component: PageNotFoundComponent}
];
