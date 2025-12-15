import { PartialType } from '@nestjs/mapped-types';
import { CreateCoaDto } from './create-master.dto';

export class UpdateCoaDto extends PartialType(CreateCoaDto) {}