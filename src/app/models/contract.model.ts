import {ABIDefinition} from 'web3/eth/abi';

export class Contract {
  address: string;
  byte_code: string;
  valid: boolean;
  contract_name: string;
  compiler_version: string;
  optimization: boolean;
  source_code: string;
  abi: ABIDefinition[];
  created_at: Date;
  updated_at: Date;
}
