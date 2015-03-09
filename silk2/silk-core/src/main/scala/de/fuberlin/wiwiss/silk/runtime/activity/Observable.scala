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

package de.fuberlin.wiwiss.silk.runtime.activity

import scala.collection.mutable

/**
 * An observable value.
 * 
 * @tparam T The type of the value.
 */
trait Observable[T] {

  private val subscribers = new mutable.WeakHashMap[T => _, Unit]()

  /**
   * Retrieves the current value.
   */
  def apply(): T
  
  /**
   * Execute a function on every update.
   * Note that the function is stored in a weak hash map i.e. it is removed as soon as it is no longer referenced.
   *
   * @return The provided function
   */
  def onUpdate[U](f: T => U) = synchronized {
    subscribers.update(f, Unit)
    f
  }

  /**
   * Removes a function from the subscribers list.
   */
  def removeSubscriptions() = synchronized {
    subscribers.clear()
  }

  /**
   * Called by implementing classes whenever the value has been changed.
   *
   * @param newValue The new value.
   */
  protected def publish(newValue: T) = {
    for(subscriber <- subscribers.keys)
      subscriber(newValue)
  }
}