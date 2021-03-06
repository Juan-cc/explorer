/*CORE*/
import {Component, OnInit} from '@angular/core';
import {FormArray, FormBuilder, FormControl, FormGroup, Validators} from '@angular/forms';
import {ActivatedRoute, ParamMap} from '@angular/router';
import {forkJoin, Subscription} from 'rxjs';
import {debounceTime, distinctUntilChanged, filter} from 'rxjs/operators';
/*SERVICES*/
import {WalletService} from '../wallet.service';
import {ToastrService} from '../../toastr/toastr.service';
import {CommonService} from '../../../services/common.service';
import {MetaService} from '../../../services/meta.service';
/*MODELS*/
import Web3Contract from 'web3/eth/contract';
import {ABIDefinition} from 'web3/eth/abi';
import {Tx} from 'web3/eth/types';
import {TransactionReceipt} from 'web3/types';
import {Contract} from '../../../models/contract.model';
import {Address} from '../../../models/address.model';
import {Badge} from '../../../models/badge.model';
/*UTILS*/
import {AutoUnsubscribe} from '../../../decorators/auto-unsubscribe';
import {DEFAULT_GAS_LIMIT, ERC_INTERFACE_IDENTIFIERS, META_TITLES} from '../../../utils/constants';
import {ErcName} from '../../../utils/enums';
import {getAbiMethods, getDecodedData, isHex, makeContractAbi, makeContractBadges} from '../../../utils/functions';
import {ContractAbi} from '../../../utils/types';
import BigNumber from 'bignumber.js';

@Component({
  selector: 'app-wallet-send',
  templateUrl: './wallet-send.component.html',
  styleUrls: ['./wallet-send.component.scss']
})
@AutoUnsubscribe('_subsArr$')
export class WalletSendComponent implements OnInit {

  privateKeyForm: FormGroup = this._fb.group({
    privateKey: ['', Validators.compose([Validators.required, WalletSendComponent.checkKeys])],
  });

  sendGoForm: FormGroup = this._fb.group({
    to: ['', Validators.required],
    amount: ['', Validators.required],
    gasLimit: [DEFAULT_GAS_LIMIT, Validators.required],
  });

  deployContractForm: FormGroup = this._fb.group({
    byteCode: ['', Validators.required],
    gasLimit: ['', Validators.required],
  });

  useContractForm: FormGroup = this._fb.group({
    contractAddress: ['', Validators.required],
    contractAmount: ['', []],
    contractABI: ['', []],
    contractFunction: [''],
    functionParameters: this._fb.array([]),
    gasLimit: ['', Validators.required],
  });


  balance: string;
  fromAccount: any;
  address: string; // this is if it's not a private key being used
  receipt: TransactionReceipt;
  isProcessing = false;

  // Contract stuff
  contract: Web3Contract;
  selectedFunction: ABIDefinition;
  functionResult: any[][];

  isOpening = false;

  contractBadges: Badge[] = [];

  abiTemplates = [ErcName.Go20, ErcName.Go721];

  addr: Address;

  private _subsArr$: Subscription[] = [];

  /**
   *
   * @param fc
   */
  static checkKeys(fc: FormControl) {
    if (!fc.value) {
      return;
    }
    const address_or_key = fc.value.toLowerCase();
    if (/^(0x)?[0-9a-f]{40}$/i.test(address_or_key)
      || /^[0-9a-f]{40}$/i.test(address_or_key)
      || /^[0-9a-f]{64}$/i.test(address_or_key)
      || /^(0x)?[0-9a-f]{64}$/i.test(address_or_key)) {
      return null;
    }
    return ({checkKeys: true});
  }

  get functionParameters() {
    return this.useContractForm.get('functionParameters') as FormArray;
  }

  constructor(
    private _walletService: WalletService,
    private _fb: FormBuilder,
    private _toastrService: ToastrService,
    private _activatedRoute: ActivatedRoute,
    private _commonService: CommonService,
    private _metaService: MetaService,
  ) {
  }

  ngOnInit() {
    this._metaService.setTitle(META_TITLES.OPEN_WALLET.title);
    this._subsArr$.push(
      this._activatedRoute.queryParamMap.pipe(
        filter((params: ParamMap) => params.has('address'))
      ).subscribe((params: ParamMap) => {
        const addr = params.get('address');
        if (addr.length === 42) {
          this.useContractForm.patchValue({
            contractAddress: addr
          });
          this.getContractData(addr);
        } else {
          this._toastrService.warning('Contract address is invalid');
        }
      })
    );
    this._subsArr$.push(this.useContractForm.get('contractAddress').valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
    ).subscribe(val => {
      this.updateContractInfo();
      this.getContractData(val);
    }));
    this._subsArr$.push(this.useContractForm.get('contractABI').valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
    ).subscribe(val => {
      this.updateContractInfo();
    }));
    this._subsArr$.push(this.useContractForm.get('contractFunction').valueChanges.subscribe(value => {
      this.loadFunction(value);
    }));

    this._subsArr$.push(this.deployContractForm.get('byteCode').valueChanges.pipe(
      debounceTime(250),
      distinctUntilChanged(),
    ).subscribe((value: string) => {
      this.estimateDeploymentGas(value);
    }));

    this._subsArr$.push((this.useContractForm.get('functionParameters') as FormArray).valueChanges.pipe(
      debounceTime(1200),
      distinctUntilChanged(),
    ).subscribe((values) => {
      this.estimateFunctionGas(values);
    }));
  }

  private getContractData(addrHash: string) {
    if (!addrHash && addrHash.length !== 42) {
      return;
    }
    forkJoin([
      this._commonService.getAddress(addrHash),
      this._commonService.getContract(addrHash),
    ]).pipe(
      filter((data: [Address, Contract]) => !!data[0] && !!data[1]),
    ).subscribe((data: [Address, Contract]) => {
      this.handleContractData(data[0], data[1]);
    });
  }

  private handleContractData(address: Address, contract: Contract) {
    this.addr = address;
    this.contractBadges = makeContractBadges(address, contract);
    if (contract.abi && contract.abi.length) {
      this.useContractForm.patchValue({
        contractABI: JSON.stringify(contract.abi),
      }, {
        emitEvent: false,
      });
      this.initiateContract(contract.abi, address.address);
    } else if (address.interfaces && address.interfaces.length) {
      this._walletService.abi$.subscribe((abiDefinitions: ContractAbi) => {
        const abi: ABIDefinition[] = address.interfaces.reduce((acc, abiName) => {
          if (abiDefinitions[abiName]) {
            acc.push(abiDefinitions[abiName]);
          }
          return acc;
        }, []);
        this.useContractForm.patchValue({
          contractABI: JSON.stringify(abi),
        }, {
          emitEvent: false,
        });
        this.initiateContract(abi, address.address);
      });
    }
  }

  private initiateContract(abi: ABIDefinition[], addrHash: string) {
    try {
      this.contract = new this._walletService.w3.eth.Contract(abi, addrHash);
    } catch (e) {
      this._toastrService.danger('Can]\'t initiate contract, check entered data');
      return;
    }
  }

  /**
   *
   * @param functionIndex
   */
  loadFunction(functionIndex: number): void {
    this.selectedFunction = null;
    this.functionResult = null;
    this.resetFunctionParameter();
    const abi = this.contract.options.jsonInterface;
    const func = abi[functionIndex];
    this.selectedFunction = func;
    // TODO: IF ANY INPUTS, add a sub formgroup
    // if constant, just show value immediately
    if (func.constant && !func.inputs.length) {
      // There's a bug in the response here: https://github.com/ethereum/web3.js/issues/1566
      // So doing it myself... :frowning:
      this.callABIFunction(func, []);
    } else {
      // must write a tx to get do this
      func.inputs.forEach(() => {
        this.addFunctionParameter();
      });
    }
  }

  addFunctionParameter() {
    this.functionParameters.push(this._fb.control(''));
  }

  /**
   *
   * @param func
   * @param params
   */
  callABIFunction(func: ABIDefinition, params: string[]): void {
    this._walletService.call(this.contract.options.address, func, params).then((decoded: object) => {
      this.functionResult = getDecodedData(decoded, func, this.addr);
    }).catch(err => {
      this._toastrService.danger(err);
    });
  }

  resetFunctionParameter() {
    while (this.functionParameters.length !== 0) {
      this.functionParameters.removeAt(0);
    }
  }

  funcsToSelect(): ABIDefinition[] {
    const abi: ABIDefinition[] = this.contract.options.jsonInterface;
    return getAbiMethods(abi);
  }

  reset() {
    this.balance = null;
    this.fromAccount = null;
    this.address = null;
    this.selectedFunction = null;
    this.receipt = null;
  }

  closeWallet() {
    this.reset();
    this.resetForms();
    this.privateKeyForm.reset();
  }

  onPrivateKeySubmit() {
    this.reset();
    this.isOpening = true;
    let val: string = this.privateKeyForm.get('privateKey').value;

    if (val.length === 64 && val.indexOf('0x') !== 0) {
      val = '0x' + val;
      this.privateKeyForm.get('privateKey').setValue(val);
    }

    if (val.length === 66) {
      try {
        this.fromAccount = this._walletService.w3.eth.accounts.privateKeyToAccount(val);
        this.address = this.fromAccount.address;
        this.updateBalance();
        this._metaService.setTitle(META_TITLES.WALLET.title);
      } catch (e) {
        this._toastrService.danger(e);
        this.isOpening = false;
      }
      return;
    }

    this._toastrService.danger('Given private key is not valid');
    this.isOpening = false;
  }

  onTokenValueChange(event, controlIndex: number): void {
    let value: string = (<HTMLInputElement>event.target).value;
    if (value) {
      value = (new BigNumber(value)).multipliedBy('1e' + this.addr.decimals).toString();
      if (/e+/.test(value)) {
        const parts = value.split('e+');
        let first = parts[0].replace('.', '');
        const zeroes = parseInt(parts[1], 10) - (first.length - 1);
        for (let i = 0; i < zeroes; i++) {
          first += '0';
        }
        value = first;
      }
    }
    this.functionParameters.controls[controlIndex].patchValue(value, {
      emitEvent: true,
    });
  }

  updateBalance() {
    if (this._walletService.isAddress(this.address)) {
      this._walletService.getBalance(this.address).subscribe(balance => {
          this._toastrService.info('Updated balance.');
          this.balance = balance.toString();
        },
        err => {
          this._toastrService.danger(err);
          this.isOpening = false;
        },
        () => this.isOpening = false);
    }
  }

  updateContractInfo(): void {
    this.contract = null;
    const addr: string = this.useContractForm.get('contractAddress').value;
    let abi = this.useContractForm.get('contractABI').value;
    if (!addr) {
      return;
    }
    if (addr.length !== 42) {
      this._toastrService.danger('Wrong contract address');
      return;
    }
    if (!abi) {
      return;
    }

    if (abi && abi.length > 0) {
      try {
        abi = JSON.parse(abi);
      } catch (e) {
        this._toastrService.danger('Can\'t parse contract abi');
        return;
      }
      this.initiateContract(abi, addr);
    }
  }

  sendGo() {
    if (this.isProcessing) {
      return;
    }

    if (!this.sendGoForm.valid) {
      this._toastrService.warning('Some field is wrong');
      return;
    }

    const to = this.sendGoForm.get('to').value;

    if (to.length !== 42 || !this._walletService.isAddress(to)) {
      this._toastrService.danger('ERROR: Invalid TO address.');
      return;
    }

    let value = this.sendGoForm.get('amount').value;

    try {
      value = this._walletService.w3.utils.toWei(value, 'ether');
    } catch (e) {
      this._toastrService.danger(e);
      return;
    }

    const gas = this.sendGoForm.get('gasLimit').value;

    const tx: Tx = {
      to,
      value,
      gas
    };

    this.sendAndWait(tx);
  }

  deployContract() {
    if (this.isProcessing) {
      return;
    }

    let byteCode = this.deployContractForm.get('byteCode').value;

    if (!byteCode) {
      this._toastrService.danger('ERROR: Invalid data provided.');
      return;
    }

    if (!byteCode.startsWith('0x')) {
      byteCode = '0x' + byteCode;
    }

    const gas = this.deployContractForm.get('gasLimit').value;

    const tx: Tx = {
      data: byteCode,
      gas
    };

    this.sendAndWait(tx);
  }

  useContract() {
    if (this.isProcessing) {
      return;
    }

    const params: string[] = [];

    if (this.selectedFunction.inputs.length) {
      this.functionParameters.controls.forEach(control => {
        params.push(control.value);
      });
    }
    let tx: Tx;

    if (this.selectedFunction.payable || !this.selectedFunction.constant) {
      try {
        tx = this.formTx(params);
      } catch (e) {
        this._toastrService.danger(e);
        return;
      }
    } else {
      this.callABIFunction(this.selectedFunction, params);
      return;
    }

    tx.gas = this.useContractForm.get('gasLimit').value;

    this.sendAndWait(tx);
  }

  formTx(params: string[]): Tx {
    const m = this.contract.methods[this.selectedFunction.name](...params);

    const tx: Tx = {
      to: this.contract.options.address,
      data: m.encodeABI(),
      from: this.address,
    };

    if (this.selectedFunction.payable) {
      const amount = this.useContractForm.get('contractAmount').value;
      try {
        tx.value = this._walletService.w3.utils.toWei(amount, 'ether');
      } catch (e) {
        throw Error('Cannot convert amount,' + e);
      }
    }

    return tx;
  }

  sendAndWait(tx: Tx) {
    this.isProcessing = true;

    const privateKey: string = this.privateKeyForm.get('privateKey').value;

    this._walletService.sendTx(
      privateKey,
      tx
    ).subscribe((receipt: TransactionReceipt) => {
        this.receipt = receipt;
        this.updateBalance();
      },
      err => {
        this._toastrService.danger(err);
        this.isProcessing = false;
      });
  }

  onTabChange(tabName: string) {
    /*this.receipt = null;
    switch (tabName) {
      case 'send_go':
        this.sendGoForm.reset();
        break;
      case 'deploy_contract':
        this.deployContractForm.reset();
        break;
      case 'use_contract':
        this.useContractForm.reset();
        break;
    }*/
  }

  resetForms() {
    this.sendGoForm.reset();
    this.sendGoForm.get('gasLimit').setValue(DEFAULT_GAS_LIMIT);
    this.deployContractForm.reset();
    this.deployContractForm.get('gasLimit').setValue('');
    this.useContractForm.reset();
    this.useContractForm.get('gasLimit').setValue('');
  }

  resetProcessing() {
    this.isProcessing = false;
    this.receipt = null;
  }

  onAbiTemplateClick(ercName: ErcName) {
    this._walletService.abi$.subscribe((abi: ContractAbi) => {
      const ABI: ABIDefinition[] = makeContractAbi(ERC_INTERFACE_IDENTIFIERS[ercName], abi);
      const addr: string = this.useContractForm.get('contractAddress').value;
      this.useContractForm.patchValue({
        contractABI: JSON.stringify(ABI),
      }, {
        emitEvent: false,
      });
      if (addr.length === 42 && ABI.length) {
        this.initiateContract(ABI, addr);
      }
    });
  }

  private estimateDeploymentGas(byteCode: string): void {
    if (!byteCode) {
      this.deployContractForm.get('gasLimit').patchValue('');
      return;
    }
    if (!isHex(byteCode)) {
      this._toastrService.danger('bytecode is not correct');
      return;
    }
    if (!byteCode.startsWith('0x')) {
      byteCode = '0x' + byteCode;
    }
    const tx: Tx = {data: byteCode};
    this._walletService.estimateGas(tx).pipe(
      filter((gasLimit: number) => !this.isProcessing),
    ).subscribe((gasLimit: number) => {
      this.deployContractForm.get('gasLimit').patchValue(gasLimit);
    });
  }

  private estimateFunctionGas(values: string[]): void {
    if (!this.selectedFunction.payable && this.selectedFunction.constant) {
      return;
    }
    if (values.some(value => !value)) {
      this.useContractForm.get('gasLimit').patchValue('');
      return;
    }

    let tx: Tx;

    try {
      tx = this.formTx(values);
    } catch (e) {
      return;
    }

    this._walletService.estimateGas(tx).pipe(
      filter((gasLimit: number) => !this.isProcessing),
    ).subscribe((gasLimit: number) => {
      this.useContractForm.get('gasLimit').patchValue(gasLimit);
    });
  }
}
