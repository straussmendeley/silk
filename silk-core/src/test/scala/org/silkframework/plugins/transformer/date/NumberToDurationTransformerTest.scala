/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.silkframework.plugins.transformer.date

import org.scalatest.{FlatSpec, Matchers}

class NumberToDurationTransformerTest extends FlatSpec with Matchers {

  val transformer = NumberToDurationTransformer(DateUnit.day)

  "NumberToDurationTransformer" should "convert numbers to days" in {
    transformer(Seq(Seq("4"))) should equal(Seq("P0Y0M4DT0H0M0.000S"))
    transformer(Seq(Seq("0"))) should equal(Seq("P0Y0M0DT0H0M0.000S"))
  }
}
