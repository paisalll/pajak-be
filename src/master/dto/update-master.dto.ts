import { PartialType } from '@nestjs/mapped-types';
import { CreateCoaDto, CreateCompanyDto, CreatePartnerDto, CreatePphDto, CreatePpnDto } from './create-master.dto';

export class UpdateCoaDto extends PartialType(CreateCoaDto) {}
export class UpdatePartnerDto extends PartialType(CreatePartnerDto) {}
export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}
export class UpdatePpnDto extends PartialType(CreatePpnDto) {}
export class UpdatePphDto extends PartialType(CreatePphDto) {}