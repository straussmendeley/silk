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

package org.silkframework.util

import java.io._

import scala.language.implicitConversions
import scala.xml.{NodeSeq, PrettyPrinter}

/**
 * Defines additional methods on XML, which are missing in the standard library.
 */
object XMLUtils {
  implicit def toXMLUtils(xml: NodeSeq): XMLUtils = new XMLUtils(xml)
}

/**
 * Defines additional methods on XML, which are missing in the standard library.
 */
class XMLUtils(xml: NodeSeq) {
  def toFormattedString = {
    val stringWriter = new StringWriter()
    write(stringWriter, prettyPrint = true)
    stringWriter.toString
  }

  def write(file: File, prettyPrint: Boolean) {
    val fileWriter = new OutputStreamWriter(new FileOutputStream(file), "UTF-8")
    try {
      write(fileWriter, prettyPrint)
    }
    finally {
      fileWriter.close()
    }
  }

  def write(writer: Writer, prettyPrint: Boolean) {
    if(prettyPrint) {
      val printer = new PrettyPrinter(Int.MaxValue, 2)
      writer.write(printer.formatNodes(xml))
    } else {
      writer.write(xml.toString())
    }
    writer.write("\n")
    writer.flush()
  }

  def write(outputStream: OutputStream, prettyPrint: Boolean) {
    write(new OutputStreamWriter(outputStream, "UTF-8"), prettyPrint)
  }
}
