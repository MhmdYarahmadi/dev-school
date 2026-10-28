import { dockerContent } from '../courses/docker/content';
import { gitContent } from '../courses/git/content';
import { pgContent } from '../courses/pg/content';
import { sdContent } from '../courses/sd/content';
import type { CourseContent } from './course';

/** Every course on Dev School (data only, used by the admin dashboard). */
export const COURSES: CourseContent[] = [pgContent, dockerContent, sdContent, gitContent];
